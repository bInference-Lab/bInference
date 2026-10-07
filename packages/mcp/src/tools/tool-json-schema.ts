import type { JsonSchema } from "@binference/protocol";
import {
  alternativesOf,
  type ObjectVariant,
  objectVariantsOf,
  stringChoicesOf,
} from "./json-schema-parts.schema.js";

function distinct(schemas: readonly JsonSchema[]): readonly JsonSchema[] {
  const byText = new Map(schemas.map((schema) => [JSON.stringify(schema), schema]));
  return [...byText.values()];
}

// The alternatives of one property across the variants: string constants and enums become one
// enum, one shape stays as it is, and different shapes become `anyOf`.
function mergeProperty(alternatives: readonly JsonSchema[]): JsonSchema {
  const merged = distinct(alternatives.flatMap(alternativesOf));
  const choices = merged.map(stringChoicesOf);
  if (merged.length > 1 && choices.every((choice) => choice !== undefined)) {
    return { type: "string", enum: [...new Set(choices.flat())] };
  }
  const [only] = merged;
  return merged.length === 1 && only !== undefined ? only : { anyOf: merged };
}

function mergedProperties(variants: readonly ObjectVariant[]): Record<string, JsonSchema> {
  const alternatives = new Map<string, JsonSchema[]>();
  for (const variant of variants) {
    for (const [name, schema] of Object.entries(variant.properties)) {
      alternatives.set(name, [...(alternatives.get(name) ?? []), schema]);
    }
  }
  return Object.fromEntries(
    [...alternatives].map(([name, schemas]) => [name, mergeProperty(schemas)]),
  );
}

/** The fields every variant requires, in the order the first variant lists them. */
export function requiredByAll(variants: readonly ObjectVariant[]): readonly string[] {
  const [first, ...rest] = variants;
  return (first?.required ?? []).filter((name) =>
    rest.every((variant) => variant.required?.includes(name) === true),
  );
}

/**
 * The input schema MCP clients take for an operation's args, from its JSON Schema in
 * `engine/describe`. MCP and the model APIs behind its clients need an object at the root, so an
 * args schema whose root is a union of objects, such as an intent request, becomes one object:
 * every variant's properties with their alternatives merged, required only where every variant
 * requires them. The operation's own schema still checks each call, variant by variant. Any other
 * schema is returned as it is.
 */
export function toolJsonSchema(args: JsonSchema): JsonSchema {
  const variants = objectVariantsOf(args);
  if (variants === undefined) {
    return args;
  }
  const closed = variants.every((variant) => variant.additionalProperties === false);
  return {
    ...(args["$schema"] === undefined ? {} : { $schema: args["$schema"] }),
    type: "object",
    properties: mergedProperties(variants),
    required: requiredByAll(variants),
    ...(closed ? { additionalProperties: false } : {}),
  };
}
