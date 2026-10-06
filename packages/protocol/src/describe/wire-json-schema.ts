import type { z } from "zod";

/**
 * The options that convert a schema to the JSON Schema of its wire form, where optional fields
 * are absent and amounts are decimal strings. A schema with no JSON Schema form throws.
 */
export const wireJsonOptions: z.core.ToJSONSchemaParams = {
  io: "input",
  unrepresentable: "throw",
};
