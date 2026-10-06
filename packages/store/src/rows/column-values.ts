import { decimalStringSchema, type JsonValue, jsonValueSchema } from "@binference/core";

// Converts between records and the column values SQLite stores (database spec, section 1):
// amounts as decimal text, flags as 0 or 1, JSON documents as text that is parsed on every read,
// and NULL for an absent value.

/** A JSON document as its column stores it. */
export function jsonText(value: JsonValue): string {
  return JSON.stringify(value);
}

/** An optional JSON document as its column stores it: NULL when absent. */
export function optionalJsonText(value: JsonValue | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/** Parses a JSON column's text into a document. */
export function readJson(text: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(text));
}

/**
 * The field `key` holding a nullable column's value, or no field for NULL, to spread into a row's
 * record before its schema parses it.
 */
export function field<V>(key: string, value: V | null): Readonly<Record<string, V>> {
  return value === null ? {} : { [key]: value };
}

/** The field `key` holding a nullable JSON column's document, or no field for NULL. */
export function jsonField(key: string, text: string | null): Readonly<Record<string, JsonValue>> {
  return text === null ? {} : { [key]: readJson(text) };
}

/** A value for a nullable column: NULL when absent. */
export function orNull<V>(value: V | undefined): V | null {
  return value ?? null;
}

/** An amount as its TEXT column stores it: a decimal string with no sign. */
export function decimalText(value: bigint): string {
  return decimalStringSchema.encode(value);
}

/** Reads an amount from its decimal text. */
export function readDecimal(text: string): bigint {
  return decimalStringSchema.parse(text);
}
