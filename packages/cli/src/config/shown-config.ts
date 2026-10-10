import { type JsonValue, jsonValueSchema } from "@binference/core";
import type { BinferenceConfig } from "./schema/config.schema.js";

const secretKinds: ReadonlySet<string> = new Set([
  "fromKeychain",
  "fromEnv",
  "fromFile",
  "fromCommand",
]);

/** Whether a value is a JSON object, not a list, a scalar or nothing. */
export function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The kind of a secret source, such as `fromKeychain`, or `undefined` for any other value. A
 * secret source is shown as its kind: the variable, file or program it names stays out.
 */
export function secretKindOf(value: JsonValue): string | undefined {
  const keys = isObject(value) ? Object.keys(value) : [];
  const [only] = keys;
  return keys.length === 1 && only !== undefined && secretKinds.has(only) ? only : undefined;
}

/** The config as JSON: the amounts the schema keeps as bigint become decimal text. */
export function asJson(config: BinferenceConfig): JsonValue {
  const text = JSON.stringify(config, (_key: string, value: JsonValue | bigint) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return jsonValueSchema.parse(JSON.parse(text));
}

function shown(value: JsonValue): JsonValue {
  const kind = secretKindOf(value);
  if (kind !== undefined) {
    return kind;
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shown(child)]));
  }
  return Array.isArray(value) ? value.map(shown) : value;
}

/**
 * The config as a client may see it (protocol spec, section 7.9): every secret source shown as
 * its kind only, such as `"fromKeychain"`, and every amount as decimal text.
 */
export function shownConfig(config: BinferenceConfig): { readonly [key: string]: JsonValue } {
  const value = shown(asJson(config));
  return isObject(value) ? value : {};
}
