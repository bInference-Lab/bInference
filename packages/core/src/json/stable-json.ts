import type { JsonValue } from "./json-value.schema.js";

type Field = readonly [string, JsonValue];

function isList(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function byKey(left: Field, right: Field): number {
  return left[0] < right[0] ? -1 : 1;
}

/**
 * Writes a JSON document as canonical text: object keys sorted by UTF-16 code units, no spaces.
 * Two equal documents give the same text whatever order their keys were written in, so a hash over
 * the text identifies the document.
 */
export function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (isList(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const fields = Object.entries(value)
    .toSorted(byKey)
    .map((field: Field) => `${JSON.stringify(field[0])}:${stableJson(field[1])}`);
  return `{${fields.join(",")}}`;
}
