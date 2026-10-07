import type { JsonSchema } from "@binference/protocol";
import {
  constOf,
  type ObjectVariant,
  objectOf,
  objectVariantsOf,
} from "./json-schema-parts.schema.js";
import { requiredByAll } from "./tool-json-schema.js";

function fieldText(variant: ObjectVariant, name: string): string {
  const mark = variant.required?.includes(name) === true ? "" : "?";
  const schema = variant.properties[name];
  const object = schema === undefined ? undefined : objectOf(schema);
  if (object === undefined) {
    return `${name}${mark}`;
  }
  const inner = Object.keys(object.properties).map((field) => fieldText(object, field));
  return `${name}${mark} {${inner.join(", ")}}`;
}

// A field every variant holds with the same schema and the same required mark.
function sharedBy(variants: readonly ObjectVariant[], name: string): boolean {
  const texts = variants.map((variant) => {
    const schema = variant.properties[name];
    return schema === undefined ? undefined : JSON.stringify([schema, fieldText(variant, name)]);
  });
  return texts.every((text) => text !== undefined && text === texts[0]);
}

function discriminatorOf(variants: readonly ObjectVariant[]): string | undefined {
  return requiredByAll(variants).find((name) =>
    variants.every((variant) => constOf(variant, name) !== undefined),
  );
}

/**
 * A sentence for a tool's description that says which fields each kind of request takes, read
 * from the union at the root of the operation's args schema. The merged input schema an MCP
 * client sees cannot say which fields go with which kind, so the model reads it here. A field
 * marked `?` is optional, and an object field lists its own fields in braces. None for an args
 * schema of one object.
 */
export function kindFieldsText(args: JsonSchema): string | undefined {
  const variants = objectVariantsOf(args);
  const discriminator = variants === undefined ? undefined : discriminatorOf(variants);
  const [first] = variants ?? [];
  if (variants === undefined || discriminator === undefined || first === undefined) {
    return undefined;
  }
  const names = (variant: ObjectVariant): readonly string[] =>
    Object.keys(variant.properties).filter((name) => name !== discriminator);
  const shared = names(first).filter((name) => sharedBy(variants, name));
  const kinds = variants.map((variant) => {
    const own = names(variant).filter((name) => !shared.includes(name));
    const fields = own.map((name) => fieldText(variant, name));
    return `${constOf(variant, discriminator) ?? "?"}: ${fields.join(", ") || "nothing more"}`;
  });
  const common = shared.map((name) => fieldText(first, name)).join(", ");
  return `Every ${discriminator} takes ${common}. Each ${discriminator} adds: ${kinds.join("; ")}.`;
}
