import { isQuote, stringEnd } from "./json-text-scan.js";
import type { FixedText, RepairStep } from "./repair-step.js";

// The escapes a JSON string takes after a backslash; `u` comes with its four hex digits.
const jsonEscapes: ReadonlySet<string> = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

// A single-quoted string's body as a JSON string's body, its characters unchanged, or none when it
// holds an escape JSON lacks.
function doubleQuotedBody(body: string): string | undefined {
  let out = "";
  let at = 0;
  while (at < body.length) {
    const char = body.charAt(at);
    if (char !== "\\") {
      out += char === '"' ? '\\"' : char;
      at += 1;
      continue;
    }
    const next = body.charAt(at + 1);
    if (next !== "'" && !jsonEscapes.has(next)) {
      return undefined;
    }
    out += next === "'" ? "'" : `\\${next}`;
    at += 2;
  }
  return out;
}

/** A string of the text as the repair writes it, and where the text goes on after it. */
interface Piece {
  readonly text: string;
  readonly end: number;
  readonly changed: boolean;
}

// The string that opens at `start`: a double-quoted one as it is, even when the text ends inside
// it, and a single-quoted one in double quotes; none for a single-quoted one that never closes or
// holds an escape JSON lacks.
function quotedPiece(text: string, start: number): Piece | undefined {
  const quote = text.charAt(start);
  const end = stringEnd(text, start, quote);
  if (quote === '"') {
    const to = end ?? text.length;
    return { text: text.slice(start, to), end: to, changed: false };
  }
  const body = end === undefined ? undefined : doubleQuotedBody(text.slice(start + 1, end - 1));
  return body === undefined || end === undefined
    ? undefined
    : { text: `"${body}"`, end, changed: true };
}

function nextQuote(text: string, from: number): number {
  let at = from;
  while (at < text.length && !isQuote(text.charAt(at))) {
    at += 1;
  }
  return at;
}

// Each string in single quotes written in double quotes (`single_quotes`).
function withDoubleQuotes(text: string): FixedText | undefined {
  let out = "";
  let at = 0;
  let changed = false;
  while (at < text.length) {
    const quote = nextQuote(text, at);
    out += text.slice(at, quote);
    if (quote === text.length) {
      break;
    }
    const piece = quotedPiece(text, quote);
    if (piece === undefined) {
      return undefined;
    }
    out += piece.text;
    changed ||= piece.changed;
    at = piece.end;
  }
  return { text: out, steps: changed ? ["single_quotes"] : [] };
}

function closesNext(text: string, comma: number): boolean {
  let at = comma + 1;
  while (/\s/u.test(text.charAt(at))) {
    at += 1;
  }
  const next = text.charAt(at);
  return next === "}" || next === "]";
}

// Each comma right before a closing brace or bracket, outside strings, left out (`trailing_comma`).
function withoutTrailingCommas(text: string): FixedText {
  let out = "";
  let at = 0;
  let changed = false;
  while (at < text.length) {
    const char = text.charAt(at);
    const end = char === '"' ? (stringEnd(text, at, char) ?? text.length) : at + 1;
    const dropped = char === "," && closesNext(text, at);
    out += dropped ? "" : text.slice(at, end);
    changed ||= dropped;
    at = end;
  }
  return { text: out, steps: changed ? ["trailing_comma"] : [] };
}

/** An object or a list still open, and what it waits for next. */
interface Frame {
  readonly closer: "}" | "]";
  readonly next: "key" | "colon" | "value" | "after";
}

/** Where a text leaves its brackets: the ones still open, and whether it ends on a number. */
interface Shape {
  readonly frames: readonly Frame[];
  readonly endsOnNumber: boolean;
}

function withTop(frames: readonly Frame[], next: Frame["next"]): readonly Frame[] {
  const top = frames.at(-1);
  return top === undefined ? frames : [...frames.slice(0, -1), { ...top, next }];
}

// A string is an object's key where the object waits for one, and a value anywhere else.
function afterString(frames: readonly Frame[]): readonly Frame[] {
  const top = frames.at(-1);
  return withTop(frames, top?.closer === "}" && top.next === "key" ? "colon" : "after");
}

const tokenEnd = /[\s,:{}[\]"]/u;

function tokenAt(text: string, start: number): string {
  let end = start;
  while (end < text.length && !tokenEnd.test(text.charAt(end))) {
    end += 1;
  }
  return text.slice(start, end);
}

function stepped(frames: readonly Frame[], char: string): readonly Frame[] {
  const top = frames.at(-1);
  switch (char) {
    case "{":
      return [...frames, { closer: "}", next: "key" }];
    case "[":
      return [...frames, { closer: "]", next: "value" }];
    case "}":
    case "]":
      return withTop(frames.slice(0, -1), "after");
    case ":":
      return withTop(frames, "value");
    case ",":
      return withTop(frames, top?.closer === "}" ? "key" : "value");
    default:
      return withTop(frames, "after");
  }
}

// The brackets a text leaves open; none when it ends inside a string.
function shapeOf(text: string): Shape | undefined {
  let frames: readonly Frame[] = [];
  let endsOnNumber = false;
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '"') {
      const end = stringEnd(text, at, char);
      if (end === undefined) {
        return undefined;
      }
      frames = afterString(frames);
      endsOnNumber = false;
      at = end;
    } else if (/\s/u.test(char)) {
      at += 1;
    } else {
      const token = "{[]}:,".includes(char) ? char : tokenAt(text, at);
      frames = stepped(frames, token);
      endsOnNumber = /^-?\d/u.test(token);
      at += token.length;
    }
  }
  return { frames, endsOnNumber };
}

// The objects and lists left open closed, when the text ends right after a whole value
// (`closed`). A number there may be cut short, so it ends the repair, as does text that ends
// inside a string, after a key, a colon or a comma.
function withClosedBrackets(text: string): FixedText | undefined {
  const shape = shapeOf(text);
  if (shape === undefined) {
    return undefined;
  }
  if (shape.frames.length === 0) {
    return { text, steps: [] };
  }
  if (shape.frames.at(-1)?.next !== "after" || shape.endsOnNumber) {
    return undefined;
  }
  const closers = shape.frames.map((frame) => frame.closer).toReversed();
  return { text: `${text.trimEnd()}${closers.join("")}`, steps: ["closed"] };
}

/**
 * Fixes how the arguments' JSON is written (runtime spec, section 5.6), in this order: strings in
 * single quotes (`single_quotes`), commas before a closing bracket (`trailing_comma`), and
 * brackets left open after a whole value (`closed`). Answers `undefined` when a step cannot fix
 * the text without a guess; a value is never added, removed or changed.
 */
export function fixJsonText(written: string): FixedText | undefined {
  const quoted = withDoubleQuotes(written);
  if (quoted === undefined) {
    return undefined;
  }
  const commas = withoutTrailingCommas(quoted.text);
  const closed = withClosedBrackets(commas.text);
  if (closed === undefined) {
    return undefined;
  }
  const steps: readonly RepairStep[] = [...quoted.steps, ...commas.steps, ...closed.steps];
  return { text: closed.text, steps };
}
