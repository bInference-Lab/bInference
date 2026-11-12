import type { JsonValue } from "./json-value.schema.js";

// U+0000, which Postgres stores in no text and no jsonb, and SQLite stores in both (decision 0416).
const nul = "\u0000";
// What takes its place: U+FFFD, the replacement character.
const replacement = String.fromCodePoint(0xfffd);

// The JSON escape of U+0000 after an even run of backslashes, so `\\u0000`, a backslash and the
// letters, is left as it is.
const nulEscape = /(?<!\\)((?:\\\\)*)\\u0000/gu;

type Field = readonly [string, JsonValue];

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** `text` with each U+0000 replaced by U+FFFD (decision 0416); any other text as it is. */
export function replaceNul(text: string): string {
  return text.includes(nul) ? text.replaceAll(nul, replacement) : text;
}

/**
 * JSON `text` with U+FFFD in place of each U+0000, the character itself and its escape `\u0000`
 * alike, and every other character as it is (decision 0416): a parse of it holds no U+0000,
 * and no number or spacing of it changes.
 */
export function replaceNulInJsonText(text: string): string {
  return replaceNul(text).replaceAll(
    nulEscape,
    (_escape: string, backslashes: string) => `${backslashes}${replacement}`,
  );
}

/**
 * `value` with each U+0000 replaced by U+FFFD in every string and object key, however deep
 * (decision 0416). Numbers, booleans and null stay as they are.
 */
export function replaceNulDeep(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return replaceNul(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (isList(value)) {
    return value.map(replaceNulDeep);
  }
  return Object.fromEntries(
    Object.entries(value).map((field: Field) => [replaceNul(field[0]), replaceNulDeep(field[1])]),
  );
}
