import { z } from "zod";

/** A JSON value as a config file, an environment variable or a flag holds it before validation. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object: keys to values. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Parses any JSON value: finite numbers only, no `undefined`, no functions. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.json().meta({ id: "JsonValue" });

/** Whether a value is a JSON object, not a list, a scalar or nothing. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
