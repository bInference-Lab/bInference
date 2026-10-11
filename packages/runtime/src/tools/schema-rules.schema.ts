import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

// A schema's parts: the schemas a definition holds directly, in a list, or by name (an object's
// shape).
function partsOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null && !(value instanceof z.ZodType)) {
    return Object.values(value);
  }
  return [value];
}

/**
 * Whether a schema, or any schema inside it, coerces what it parses (`z.coerce.*`). A tool's
 * arguments never do: a number written as a string, or a string as a number, is refused.
 */
export function coerces(schema: z.ZodType, seen: Set<z.ZodType> = new Set()): boolean {
  if (seen.has(schema)) {
    return false;
  }
  seen.add(schema);
  const def: { readonly [key: string]: unknown } = { ...schema.def };
  if (def["coerce"] === true) {
    return true;
  }
  return Object.values(def)
    .flatMap(partsOf)
    .some((part) => part instanceof z.ZodType && coerces(part, seen));
}

/**
 * Whether a JSON Schema has an object that names its fields yet allows others: every object with
 * `properties` must say `additionalProperties: false`, as `z.strictObject` does.
 */
export function allowsUnnamedFields(node: JsonValue): boolean {
  if (typeof node !== "object" || node === null) {
    return false;
  }
  const record = new Map<string, JsonValue>(Object.entries(node));
  if (record.has("properties") && record.get("additionalProperties") !== false) {
    return true;
  }
  return [...record.values()].some(allowsUnnamedFields);
}

const objectSchema = z.record(z.string(), jsonValueSchema);

/**
 * The JSON Schema of what a schema reads (its input side, where money is a string), or none when
 * the schema cannot be written as one or is not an object's.
 */
export function inputJsonSchema(
  schema: z.ZodType,
): { readonly [key: string]: JsonValue } | undefined {
  try {
    const parsed = objectSchema.safeParse(z.toJSONSchema(schema, { io: "input" }));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
