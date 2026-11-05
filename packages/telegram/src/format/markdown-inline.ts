import type { RichMark, RichRun } from "./rich-line.js";

/** One step of the scan: where it ends, and either plain text or styled runs. */
type Step =
  | { readonly end: number; readonly text: string }
  | { readonly end: number; readonly runs: readonly RichRun[] };

const asciiPunctuation = /[!-/:-@[-`{-~]/u;
const wordCharacter = /[\p{L}\p{N}]/u;
const blank = /\s/u;
const special = /[\\`[*_~|]/gu;
// A closing mark or bracket further than this is not looked for, so a text full of unmatched
// marks costs a bounded scan per mark.
const maxSpan = 4_000;
// Telegram refuses long addresses; a longer one stays text.
const maxHrefLength = 2_048;
const hrefCharacters = /^[A-Za-z0-9][\w.~:/?#[\]@!$&'()*+,;=%-]*$/u;

function runLength(text: string, at: number): number {
  const character = text.charAt(at);
  let end = at;
  while (text.charAt(end) === character) {
    end += 1;
  }
  return end - at;
}

function withMark(marks: readonly RichMark[], mark: RichMark): readonly RichMark[] {
  return marks.some((given) => given.kind === mark.kind) ? marks : [...marks, mark];
}

/** The address of a link when it is `http:` or `https:` with plain URL characters, else none. */
function webHrefOf(given: string): string | undefined {
  const trimmed = given.trim();
  const href = trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
  const lower = href.toLowerCase();
  const rest = lower.startsWith("https://") ? href.slice(8) : href.slice(7);
  const isWeb = lower.startsWith("https://") || lower.startsWith("http://");
  return isWeb && href.length <= maxHrefLength && hrefCharacters.test(rest) ? href : undefined;
}

// Where the code span that opens at `at` closes: a run of exactly as many backticks.
function codeEnd(text: string, at: number): number | undefined {
  const length = runLength(text, at);
  let next = at + length;
  const last = Math.min(text.length, at + maxSpan);
  while (next < last) {
    const found = text.indexOf("`", next);
    if (found === -1 || found >= last) {
      return undefined;
    }
    const foundLength = runLength(text, found);
    if (foundLength === length) {
      return found;
    }
    next = found + foundLength;
  }
  return undefined;
}

function codeSpan(text: string, at: number, marks: readonly RichMark[]): Step {
  const length = runLength(text, at);
  const end = codeEnd(text, at);
  if (end === undefined) {
    return { end: at + length, text: "`".repeat(length) };
  }
  const inner = text.slice(at + length, end);
  const isPadded = inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ");
  const code = isPadded && inner.trim() !== "" ? inner.slice(1, -1) : inner;
  return { end: end + length, runs: [{ text: code, marks: withMark(marks, { kind: "code" }) }] };
}

// Moves past an escaped character or a whole code span, so a mark inside one never closes.
function skipOver(text: string, at: number): number {
  const character = text.charAt(at);
  if (character === "\\") {
    return at + 2;
  }
  if (character === "`") {
    const end = codeEnd(text, at);
    const length = runLength(text, at);
    return end === undefined ? at + length : end + length;
  }
  return at + 1;
}

function stylesOf(character: string, length: number): readonly RichMark[] {
  if (character === "~" || character === "|") {
    return length === 2 ? [{ kind: character === "~" ? "strike" : "spoiler" }] : [];
  }
  const styles: readonly (readonly RichMark[])[] = [
    [{ kind: "italic" }],
    [{ kind: "bold" }],
    [{ kind: "bold" }, { kind: "italic" }],
  ];
  return styles[length - 1] ?? [];
}

function canClose(text: string, at: number, length: number): boolean {
  const before = text.charAt(at - 1);
  const after = text.charAt(at + length);
  const isWordAfter = text.charAt(at) === "_" && wordCharacter.test(after);
  return before !== "" && !blank.test(before) && !isWordAfter;
}

// Where the mark run that opens at `at` closes: a run of the same character and length.
function markEnd(text: string, at: number, length: number): number | undefined {
  const character = text.charAt(at);
  const last = Math.min(text.length, at + maxSpan);
  let next = at + length;
  while (next < last) {
    if (text.charAt(next) !== character) {
      next = skipOver(text, next);
      continue;
    }
    const found = runLength(text, next);
    if (found === length && next > at + length && canClose(text, next, length)) {
      return next;
    }
    next += found;
  }
  return undefined;
}

function emphasis(text: string, at: number, marks: readonly RichMark[]): Step {
  const character = text.charAt(at);
  const length = runLength(text, at);
  const literal = { end: at + length, text: character.repeat(length) };
  const styles = stylesOf(character, length);
  const after = text.charAt(at + length);
  const isWordBefore = character === "_" && wordCharacter.test(text.charAt(at - 1));
  if (styles.length === 0 || after === "" || blank.test(after) || isWordBefore) {
    return literal;
  }
  const end = markEnd(text, at, length);
  if (end === undefined) {
    return literal;
  }
  const inner = styles.reduce(withMark, marks);
  return { end: end + length, runs: inlineRunsOf(text.slice(at + length, end), inner) };
}

// Where the bracket or parenthesis that opens at `at` closes, at the same depth.
function closingOf(text: string, at: number, pair: readonly [string, string]): number | undefined {
  const last = Math.min(text.length, at + maxSpan);
  let depth = 0;
  let next = at;
  while (next < last) {
    const character = text.charAt(next);
    depth += character === pair[0] ? 1 : 0;
    depth -= character === pair[1] ? 1 : 0;
    if (depth === 0) {
      return next;
    }
    next = skipOver(text, next);
  }
  return undefined;
}

function link(text: string, at: number, marks: readonly RichMark[]): Step {
  const labelEnd = closingOf(text, at, ["[", "]"]);
  const hrefStart = labelEnd === undefined ? -1 : labelEnd + 1;
  const hrefEnd =
    text.charAt(hrefStart) === "(" ? closingOf(text, hrefStart, ["(", ")"]) : undefined;
  if (labelEnd === undefined || hrefEnd === undefined || labelEnd === at + 1) {
    return { end: at + 1, text: "[" };
  }
  const href = webHrefOf(text.slice(hrefStart + 1, hrefEnd));
  if (href === undefined) {
    return { end: hrefEnd + 1, text: text.slice(at, hrefEnd + 1) };
  }
  const label = text.slice(at + 1, labelEnd);
  return { end: hrefEnd + 1, runs: inlineRunsOf(label, withMark(marks, { kind: "link", href })) };
}

function plainUntilSpecial(text: string, at: number): Step {
  special.lastIndex = at + 1;
  const next = special.exec(text)?.index ?? text.length;
  return { end: next, text: text.slice(at, next) };
}

function stepAt(text: string, at: number, marks: readonly RichMark[]): Step {
  const character = text.charAt(at);
  const following = text.charAt(at + 1);
  if (character === "\\" && asciiPunctuation.test(following)) {
    return { end: at + 2, text: following };
  }
  if (character === "`") {
    return codeSpan(text, at, marks);
  }
  if (character === "[" && !marks.some((mark) => mark.kind === "link")) {
    return link(text, at, marks);
  }
  if (character === "*" || character === "_" || character === "~" || character === "|") {
    return emphasis(text, at, marks);
  }
  return plainUntilSpecial(text, at);
}

/**
 * Reads the inline Markdown of one paragraph into runs: `**bold**`, `__bold__`, `*italic*`,
 * `_italic_`, `~~struck~~`, `||spoiler||`, `` `code` ``, `[label](https://…)` and backslash escapes. A mark that
 * never closes, a link to any address but `http:` or `https:`, and anything else stay as the text
 * they are. Every run's text is plain and still to be escaped.
 */
export function inlineRunsOf(text: string, marks: readonly RichMark[] = []): readonly RichRun[] {
  const runs: RichRun[] = [];
  let plain = "";
  let at = 0;
  while (at < text.length) {
    const step = stepAt(text, at, marks);
    if ("runs" in step) {
      runs.push(...(plain === "" ? [] : [{ text: plain, marks }]), ...step.runs);
      plain = "";
    } else {
      plain += step.text;
    }
    at = step.end;
  }
  return plain === "" ? runs : [...runs, { text: plain, marks }];
}
