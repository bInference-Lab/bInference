import { isJsonObject, type JsonValue } from "./json-value.schema.js";

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A key as JSON5 writes it: bare when it is an identifier, else in double quotes. */
export function json5Key(key: string): string {
  return identifier.test(key) ? key : JSON.stringify(key);
}

/** A value on one line: scalars as JSON, lists and objects such as a secret source in braces. */
export function json5Inline(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(json5Inline).join(", ")}]`;
  }
  if (isJsonObject(value)) {
    const fields = Object.entries(value).map(
      ([key, item]) => `${json5Key(key)}: ${json5Inline(item)}`,
    );
    return fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`;
  }
  return JSON.stringify(value);
}
