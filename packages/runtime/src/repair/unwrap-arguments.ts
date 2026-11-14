import { z } from "zod";
import { isQuote, stringEnd } from "./json-text-scan.js";
import type { FixedText, RepairStep } from "./repair-step.js";

const fence = "```";
// What may stand between an opening fence and the arguments: a label of letters alone on the
// fence's line, such as `json`, or only space before the object or the string that holds it.
const fenceOpening = /^(?:[A-Za-z]*[^\S\r\n]*\r?\n|\s*(?=["{]))/u;
// The most text that may sit on each side of the arguments.
const maxAroundChars = 64;
// What that text may hold: letters, space and a few marks, so never a digit, a quote, a brace or
// a square bracket, which could carry a value.
const aroundText = /^[\p{L}\p{M}\s.:_\-/<>]*$/u;

// The arguments inside one code fence, or none when the text is no single fenced block or its
// opening holds more than a label of letters on its own line.
function unfenced(text: string): string | undefined {
  if (text.length < fence.length * 2 || !text.endsWith(fence)) {
    return undefined;
  }
  const inner = text.slice(fence.length, -fence.length);
  const opening = fenceOpening.exec(inner);
  return inner.includes(fence) || opening === null
    ? undefined
    : inner.slice(opening[0].length).trim();
}

// The object a JSON string holds, one level down, or none.
function unstrung(text: string): string | undefined {
  if (!text.startsWith('"')) {
    return undefined;
  }
  try {
    const held = z.string().safeParse(JSON.parse(text));
    const inner = held.success ? held.data.trim() : "";
    return inner.startsWith("{") ? inner : undefined;
  } catch {
    return undefined;
  }
}

// The index after the bracket that closes the object at `start`, or none when the text ends
// before it closes.
function objectEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let at = start;
  while (at < text.length) {
    const char = text[at];
    if (isQuote(char)) {
      const end = stringEnd(text, at, char);
      if (end === undefined) {
        return undefined;
      }
      at = end;
      continue;
    }
    depth += char === "{" || char === "[" ? 1 : 0;
    depth -= char === "}" || char === "]" ? 1 : 0;
    if (depth === 0) {
      return at + 1;
    }
    at += 1;
  }
  return undefined;
}

function isPlainAround(text: string): boolean {
  return text.length <= maxAroundChars && aroundText.test(text);
}

// The one object between plain words, or the text as it is when nothing sits around it. An object
// left open runs to the text's end.
function unworded(text: string): FixedText | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  const end = objectEnd(text, start) ?? text.length;
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (before.trim() === "" && after.trim() === "") {
    return { text, steps: [] };
  }
  return isPlainAround(before) && isPlainAround(after)
    ? { text: text.slice(start, end), steps: ["words_around"] }
    : undefined;
}

/**
 * Takes the arguments out of what is written around them (runtime spec, section 5.6): one code
 * fence (`fence`), then a JSON string that holds the object (`string_object`), then plain words
 * on either side of the one object (`words_around`). Answers `undefined` when the text holds no
 * object, when it opens a fence that is not one block with at most a label of letters on its own
 * line, or when what sits around the object could carry a value.
 */
export function unwrapArguments(written: string): FixedText | undefined {
  const steps: RepairStep[] = [];
  let text = written.trim();
  if (text.startsWith(fence)) {
    const inFence = unfenced(text);
    if (inFence === undefined) {
      return undefined;
    }
    text = inFence;
    steps.push("fence");
  }
  const inString = unstrung(text);
  if (inString !== undefined) {
    text = inString;
    steps.push("string_object");
  }
  const between = unworded(text);
  return between === undefined
    ? undefined
    : { text: between.text, steps: [...steps, ...between.steps] };
}
