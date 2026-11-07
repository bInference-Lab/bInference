import { type JsonValue, jsonValueSchema } from "@binference/core";

/**
 * A value the owner typed after a key: JSON when the text reads as JSON (`true`, `5`, `["a"]`,
 * `"text"`), any other text as itself.
 */
export function typedValueOf(typed: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(typed);
    const value = jsonValueSchema.safeParse(parsed);
    return value.success ? value.data : typed;
  } catch {
    return typed;
  }
}
