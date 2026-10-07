import type { JsonSchema } from "@binference/protocol";
import { z } from "zod";

/** One object of a union at the root of an args schema, such as the swap request. */
export interface ObjectVariant {
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

const jsonSchema: z.ZodType<JsonSchema> = z.record(z.string(), z.unknown());

const objectVariantSchema: z.ZodType<ObjectVariant> = z.object({
  properties: z.record(z.string(), jsonSchema),
  required: z.array(z.string()).exactOptional(),
  additionalProperties: z.boolean().exactOptional(),
});

const variants = z.array(objectVariantSchema).min(1);

const unionRootSchema = z.union([z.object({ oneOf: variants }), z.object({ anyOf: variants })]);

const bareAlternativesSchema = z.strictObject({ anyOf: z.array(jsonSchema) });

const stringChoicesSchema = z.union([
  z.object({ type: z.literal("string"), const: z.string() }).transform((part) => [part.const]),
  z.object({ type: z.literal("string"), enum: z.array(z.string()) }).transform((part) => part.enum),
]);

/**
 * The objects of an args schema whose root is a union of objects, as zod writes a discriminated
 * union; none when the root is anything else, such as one object.
 */
export function objectVariantsOf(args: JsonSchema): readonly ObjectVariant[] | undefined {
  const root = unionRootSchema.safeParse(args);
  if (!root.success) {
    return undefined;
  }
  return "oneOf" in root.data ? root.data.oneOf : root.data.anyOf;
}

/** The alternatives of a schema that holds only `anyOf`; the schema itself otherwise. */
export function alternativesOf(schema: JsonSchema): readonly JsonSchema[] {
  const bare = bareAlternativesSchema.safeParse(schema);
  return bare.success ? bare.data.anyOf : [schema];
}

/** The strings a string schema allows through `const` or `enum`; none for any other schema. */
export function stringChoicesOf(schema: JsonSchema): readonly string[] | undefined {
  const choices = stringChoicesSchema.safeParse(schema);
  return choices.success ? choices.data : undefined;
}

/** The `const` of a property of a variant, such as the `kind` of a request. */
export function constOf(variant: ObjectVariant, property: string): string | undefined {
  const schema = variant.properties[property];
  const choices = schema === undefined ? undefined : stringChoicesOf(schema);
  return choices?.length === 1 ? choices[0] : undefined;
}

/** The properties and required fields of a schema that is one object; none for any other. */
export function objectOf(schema: JsonSchema): ObjectVariant | undefined {
  const object = objectVariantSchema.safeParse(schema);
  return object.success && schema["type"] === "object" ? object.data : undefined;
}
