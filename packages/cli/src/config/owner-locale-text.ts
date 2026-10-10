import { stableJson } from "@binference/core";
import type { Locale } from "@binference/protocol";
import JSON5 from "json5";
import { z } from "zod";
import { readConfigText } from "./config-text.js";
import { applyEdits } from "./migrations/config-edit.js";

/** One token of a JSON5 text: where it starts and ends, and what it is. */
interface Token {
  readonly kind: "punct" | "string" | "word";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A member of an object: its key and its value's tokens. */
interface Member {
  readonly key: string;
  readonly keyStart: number;
  readonly value: Value;
}

/** A parsed value: an object with its members, or anything else as its span of tokens. */
type Value =
  | { readonly kind: "object"; readonly openEnd: number; readonly members: readonly Member[] }
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

function parseMember(tokens: readonly Token[], at: number): Parsed<Member> | undefined {
  const keyToken = tokens[at];
  const key = keyToken === undefined ? undefined : keyOf(keyToken);
  const value = tokens[at + 1]?.text === ":" ? parseValue(tokens, at + 2) : undefined;
  if (keyToken === undefined || key === undefined || value === undefined) {
    return undefined;
  }
  const next = tokens[value.next]?.text === "," ? value.next + 1 : value.next;
  return { value: { key, keyStart: keyToken.start, value: value.value }, next };
}

// The members of an object, up to its closing brace, and the token after that brace.
function parseMembers(tokens: readonly Token[], at: number): Parsed<readonly Member[]> | undefined {
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

function parseObject(tokens: readonly Token[], open: Token, at: number): Parsed<Value> | undefined {
  const members = parseMembers(tokens, at + 1);
  return members === undefined
    ? undefined
    : { value: { kind: "object", openEnd: open.end, members: members.value }, next: members.next };
}

// An array or a scalar: the span of the tokens it covers.
function parseOther(tokens: readonly Token[], at: number): Parsed<Value> | undefined {
  const first = tokens[at];
  const next = first?.kind === "punct" ? arrayEnd(tokens, at + 1) : at + 1;
  const last = next === undefined ? undefined : tokens[next - 1];
  return first === undefined || next === undefined || last === undefined
    ? undefined
    : { value: { kind: "other", start: first.start, end: last.end }, next };
}

// A value's span: an object with its members; an array or a scalar as the tokens it covers.
function parseValue(tokens: readonly Token[], at: number): Parsed<Value> | undefined {
  const first = tokens[at];
  if (first === undefined || (first.kind === "punct" && first.text !== "{" && first.text !== "[")) {
    return undefined;
  }
  return first.kind === "punct" && first.text === "{"
    ? parseObject(tokens, first, at)
    : parseOther(tokens, at);
}

// What goes in after an object's opening brace: on a line of its own, indented as the first
// member, when the members start on a new line; else on the brace's line.
function insertion(text: string, object: Extract<Value, { kind: "object" }>, member: string) {
  const [first] = object.members;
  if (first === undefined) {
    return ` ${member} `;
  }
  const between = text.slice(object.openEnd, first.keyStart);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /[^\S\r\n]*$/.exec(between)?.[0] ?? "";
  return lineBreak.test(between) ? `${newline}${indent}${member},` : ` ${member},`;
}

function spliced(text: string, at: { readonly start: number; readonly end: number }, by: string) {
  return `${text.slice(0, at.start)}${by}${text.slice(at.end)}`;
}

// The edit that sets `owner.locale`: the value in place, or a new member at the top of `owner`,
// or a new `owner` at the top of the file.
function editOf(text: string, root: Value, locale: Locale): string | undefined {
  if (root.kind !== "object") {
    return undefined;
  }
  const quoted = JSON.stringify(locale);
  const owner = root.members.findLast((member) => member.key === "owner")?.value;
  if (owner === undefined) {
    const at = { start: root.openEnd, end: root.openEnd };
    return spliced(text, at, insertion(text, root, `owner: { locale: ${quoted} }`));
  }
  if (owner.kind !== "object") {
    return undefined;
  }
  const current = owner.members.findLast((member) => member.key === "locale")?.value;
  if (current === undefined) {
    const at = { start: owner.openEnd, end: owner.openEnd };
    return spliced(text, at, insertion(text, owner, `locale: ${quoted}`));
  }
  return current.kind === "other" ? spliced(text, current, quoted) : undefined;
}

/**
 * The text of `config.json5` with `owner.locale` set, and every other byte as it was: comments,
 * order and formatting stay (decision 0134). `undefined` when the text is no config file this
 * edit can read, or when the result would read as anything but the same file with that one value
 * set, so nothing is written then.
 */
export function withOwnerLocale(text: string, locale: Locale): string | undefined {
  const before = readConfigText(text);
  const tokens = tokensOf(text);
  if (!before.ok || tokens === undefined) {
    return undefined;
  }
  const root = parseValue(tokens, 0);
  const edited = root === undefined ? undefined : editOf(text, root.value, locale);
  const after = edited === undefined ? undefined : readConfigText(edited);
  const expected = applyEdits(before.value, [
    { kind: "set", path: ["owner", "locale"], value: locale },
  ]);
  return after?.ok === true && stableJson(after.value) === stableJson(expected)
    ? edited
    : undefined;
}
