import JSON5 from "json5";
import { z } from "zod";

// A JSON5 text read as spans: where each object, member and value starts and ends, comments and
// whitespace left out, so an edit can change one value and keep every other byte.

/** One token of a JSON5 text: where it starts and ends, and what it is. */
interface Token {
  readonly kind: "punct" | "string" | "word";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A member of an object: its key, its value, and the comma after it, if any. */
interface Json5Member {
  readonly key: string;
  readonly keyStart: number;
  readonly value: Json5Value;
  /** Where the comma after the value ends; absent for a last member written without one. */
  readonly commaEnd?: number;
}

/**
 * A parsed value: an object with its members, or anything else, an array or a scalar, as its span
 * of tokens. Every span runs from its first token's start to its last token's end.
 */
export type Json5Value =
  | {
      readonly kind: "object";
      readonly start: number;
      readonly openEnd: number;
      readonly end: number;
      readonly members: readonly Json5Member[];
    }
  | { readonly kind: "other"; readonly start: number; readonly end: number };

const puncts = new Set(["{", "}", "[", "]", ":", ","]);
const lineBreak = /[\n\r\u2028\u2029]/;
const space = /[\s\uFEFF]/;

function stringEnd(text: string, start: number): number {
  const quote = text[start];
  let at = start + 1;
  while (at < text.length && text[at] !== quote) {
    at += text[at] === "\\" ? 2 : 1;
  }
  return at < text.length ? at + 1 : -1;
}

function commentEnd(text: string, start: number): number {
  if (text.startsWith("//", start)) {
    const rest = text.slice(start).search(lineBreak);
    return rest === -1 ? text.length : start + rest;
  }
  const close = text.indexOf("*/", start + 2);
  return close === -1 ? -1 : close + 2;
}

function wordEnd(text: string, start: number): number {
  let at = start;
  while (at < text.length && !isBoundary(text, at)) {
    at += 1;
  }
  return at;
}

function isBoundary(text: string, at: number): boolean {
  const char = text[at] ?? "";
  return (
    space.test(char) ||
    puncts.has(char) ||
    isQuote(char) ||
    text.startsWith("//", at) ||
    text.startsWith("/*", at)
  );
}

function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

// A string or a word starting at `at`, or -1 for a string that never closes.
function valueToken(text: string, at: number): Token | number {
  const isString = isQuote(text[at] ?? "");
  const end = isString ? stringEnd(text, at) : wordEnd(text, at);
  return end === -1
    ? -1
    : { kind: isString ? "string" : "word", text: text.slice(at, end), start: at, end };
}

// The token at `at`, or where reading goes on after whitespace or a comment, or -1 for a string
// or comment that never closes.
function tokenAt(text: string, at: number): Token | number {
  const char = text[at] ?? "";
  if (space.test(char)) {
    return at + 1;
  }
  if (text.startsWith("//", at) || text.startsWith("/*", at)) {
    return commentEnd(text, at);
  }
  return puncts.has(char)
    ? { kind: "punct", text: char, start: at, end: at + 1 }
    : valueToken(text, at);
}

// The text's tokens with whitespace and comments left out, or `undefined` for an unclosed string
// or comment.
function tokensOf(text: string): readonly Token[] | undefined {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const next = tokenAt(text, at);
    if (next === -1) {
      return undefined;
    }
    if (typeof next === "number") {
      at = next;
    } else {
      tokens.push(next);
      at = next.end;
    }
  }
  return tokens;
}

/** A value read from the tokens, and the index of the token after it. */
interface Parsed<T> {
  readonly value: T;
  readonly next: number;
}

function keyOf(token: Token): string | undefined {
  if (token.kind === "string") {
    const decoded = z.string().safeParse(JSON5.parse(token.text));
    return decoded.success ? decoded.data : undefined;
  }
  return token.kind === "word" && /^[$A-Z_a-z][$\w]*$/.test(token.text) ? token.text : undefined;
}

function parseMember(tokens: readonly Token[], at: number): Parsed<Json5Member> | undefined {
  const keyToken = tokens[at];
  const key = keyToken === undefined ? undefined : keyOf(keyToken);
  const value = tokens[at + 1]?.text === ":" ? parseValue(tokens, at + 2) : undefined;
  if (keyToken === undefined || key === undefined || value === undefined) {
    return undefined;
  }
  const comma = tokens[value.next];
  const member = { key, keyStart: keyToken.start, value: value.value };
  return comma?.text === ","
    ? { value: { ...member, commaEnd: comma.end }, next: value.next + 1 }
    : { value: member, next: value.next };
}

// The members of an object, up to its closing brace, and the token after that brace.
function parseMembers(
  tokens: readonly Token[],
  at: number,
): Parsed<readonly Json5Member[]> | undefined {
  if (tokens[at]?.text === "}") {
    return { value: [], next: at + 1 };
  }
  const member = parseMember(tokens, at);
  const rest = member === undefined ? undefined : parseMembers(tokens, member.next);
  return member === undefined || rest === undefined
    ? undefined
    : { value: [member.value, ...rest.value], next: rest.next };
}

// The items of an array up to its closing bracket, read only to find where the array ends.
function arrayEnd(tokens: readonly Token[], at: number): number | undefined {
  const token = tokens[at];
  if (token === undefined || token.text === "]") {
    return token === undefined ? undefined : at + 1;
  }
  const item = parseValue(tokens, at);
  if (item === undefined) {
    return undefined;
  }
  return arrayEnd(tokens, tokens[item.next]?.text === "," ? item.next + 1 : item.next);
}

function parseObject(
  tokens: readonly Token[],
  open: Token,
  at: number,
): Parsed<Json5Value> | undefined {
  const members = parseMembers(tokens, at + 1);
  const close = members === undefined ? undefined : tokens[members.next - 1];
  if (members === undefined || close === undefined) {
    return undefined;
  }
  const object = { start: open.start, openEnd: open.end, end: close.end, members: members.value };
  return { value: { kind: "object", ...object }, next: members.next };
}

// An array or a scalar: the span of the tokens it covers.
function parseOther(tokens: readonly Token[], at: number): Parsed<Json5Value> | undefined {
  const first = tokens[at];
  const next = first?.kind === "punct" ? arrayEnd(tokens, at + 1) : at + 1;
  const last = next === undefined ? undefined : tokens[next - 1];
  return first === undefined || next === undefined || last === undefined
    ? undefined
    : { value: { kind: "other", start: first.start, end: last.end }, next };
}

// A value's span: an object with its members; an array or a scalar as the tokens it covers.
function parseValue(tokens: readonly Token[], at: number): Parsed<Json5Value> | undefined {
  const first = tokens[at];
  if (first === undefined || (first.kind === "punct" && first.text !== "{" && first.text !== "[")) {
    return undefined;
  }
  return first.kind === "punct" && first.text === "{"
    ? parseObject(tokens, first, at)
    : parseOther(tokens, at);
}

/**
 * Reads a JSON5 text into the spans of its top value, or `undefined` for a text with an unclosed
 * string or comment, or one that does not hold one value. Only the structure is read: whether the
 * text is valid JSON5 is the parser's to say.
 */
export function readJson5Spans(text: string): Json5Value | undefined {
  const tokens = tokensOf(text);
  const root = tokens === undefined ? undefined : parseValue(tokens, 0);
  return root === undefined || root.next !== tokens?.length ? undefined : root.value;
}
