import { z } from "zod";
import { type JsonValue, jsonValueSchema } from "./json-value.schema.js";

/** One node of a JSON Schema: an object whose keys are keywords. */
export interface JsonSchemaNode {
  readonly [key: string]: JsonValue;
}

// The JSON Schema keywords a small schema may use. Its schemas are checked in binference's own
// processes, so none may run a regex of the schema writer's (`pattern`, `patternProperties`,
// `format`) or cost more than linear time (`uniqueItems`), and none may reach elsewhere (`$ref`).
const smallSchemaKeywords: ReadonlySet<string> = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
]);

/** How deep and how long a small JSON Schema may be (decision 0343). */
export const smallJsonSchemaLimits: { readonly depth: number; readonly chars: number } = {
  depth: 8,
  chars: 16_384,
};

/** Whether a JSON value is a schema node: an object, not a list. */
export function isJsonSchemaNode(node: JsonValue): node is JsonSchemaNode {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

const listSchema = z.array(jsonValueSchema);

// A keyword's value as a list of schemas: the list it holds, or itself alone.
function schemasIn(value: JsonValue | undefined): readonly JsonValue[] {
  if (value === undefined) {
    return [];
  }
  const list = listSchema.safeParse(value);
  return list.success ? list.data : [value];
}

/**
 * The schemas a node holds: under `properties` by name, under `items` alone or in a list, under
 * `additionalProperties` when it is one, and in the lists of `anyOf`, `oneOf` and `allOf`.
 */
export function childSchemas(node: JsonSchemaNode): readonly JsonValue[] {
  const properties = node["properties"];
  const extra = node["additionalProperties"];
  return [
    ...(properties !== undefined && isJsonSchemaNode(properties) ? Object.values(properties) : []),
    ...schemasIn(node["items"]),
    ...(extra !== undefined && isJsonSchemaNode(extra) ? [extra] : []),
    ...schemasIn(node["anyOf"]),
    ...schemasIn(node["oneOf"]),
    ...schemasIn(node["allOf"]),
  ];
}

// Every node uses only the allowed keywords, within the depth bound.
function usesOnlySmallKeywords(
  node: JsonValue,
  depth: number,
  keywords: ReadonlySet<string>,
): boolean {
  if (!isJsonSchemaNode(node) || depth > smallJsonSchemaLimits.depth) {
    return false;
  }
  return (
    Object.keys(node).every((key) => smallSchemaKeywords.has(key) || keywords.has(key)) &&
    childSchemas(node).every((child) => usesOnlySmallKeywords(child, depth + 1, keywords))
  );
}

/**
 * Whether a JSON Schema is small (decision 0343): only the short list of keywords above, plus the
 * `extraKeywords` a caller allows as notes, at most 8 levels deep and 16,384 characters as JSON,
 * and one zod reads. Such a schema never runs a regex of its writer's.
 */
export function isSmallJsonSchema(
  schema: JsonSchemaNode,
  extraKeywords: ReadonlySet<string> = new Set(),
): boolean {
  if (
    JSON.stringify(schema).length > smallJsonSchemaLimits.chars ||
    !usesOnlySmallKeywords(schema, 1, extraKeywords)
  ) {
    return false;
  }
  try {
    z.fromJSONSchema(schema);
    return true;
  } catch {
    return false;
  }
}
