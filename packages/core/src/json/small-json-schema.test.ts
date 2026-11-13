import { describe, expect, it } from "vitest";
import type { JsonValue } from "./json-value.schema.js";
import {
  childSchemas,
  isSmallJsonSchema,
  type JsonSchemaNode,
  smallJsonSchemaLimits,
} from "./small-json-schema.js";

const small: JsonSchemaNode = {
  type: "object",
  properties: { symbol: { type: "string", maxLength: 12 }, days: { type: "integer" } },
  required: ["symbol"],
  additionalProperties: false,
};

// A schema nested `levels` objects deep through `properties`.
function nested(levels: number): JsonSchemaNode {
  let node: JsonSchemaNode = { type: "string" };
  for (let level = 1; level < levels; level += 1) {
    node = { type: "object", properties: { inner: node } };
  }
  return node;
}

describe("isSmallJsonSchema", () => {
  it("takes a schema of the short keyword list", () => {
    expect(isSmallJsonSchema(small)).toBe(true);
  });

  it.each<readonly [string, JsonValue]>([
    ["pattern", "x"],
    ["patternProperties", { x: { type: "string" } }],
    ["format", "email"],
    ["$ref", "#/x"],
    ["uniqueItems", true],
    ["$schema", "https://json-schema.org/draft/2020-12/schema"],
  ])("refuses the keyword %s", (keyword, value) => {
    expect(isSmallJsonSchema({ ...small, [keyword]: value })).toBe(false);
  });

  it("takes a keyword the caller allows as a note", () => {
    const noted = { ...small, $schema: "https://json-schema.org/draft/2020-12/schema" };
    expect(isSmallJsonSchema(noted, new Set(["$schema"]))).toBe(true);
  });

  it("refuses a keyword hidden in a nested schema", () => {
    const hidden = { type: "array", items: { anyOf: [{ type: "string", pattern: "^(a+)+$" }] } };
    expect(isSmallJsonSchema(hidden)).toBe(false);
  });

  it("takes 8 levels and refuses 9", () => {
    expect(isSmallJsonSchema(nested(smallJsonSchemaLimits.depth))).toBe(true);
    expect(isSmallJsonSchema(nested(smallJsonSchemaLimits.depth + 1))).toBe(false);
  });

  it("refuses a schema longer than its character bound", () => {
    const long = { type: "string", description: "x".repeat(smallJsonSchemaLimits.chars) };
    expect(isSmallJsonSchema(long)).toBe(false);
  });
});

describe("childSchemas", () => {
  it("reads properties, items, additionalProperties and the lists of schemas", () => {
    const node: JsonSchemaNode = {
      properties: { a: { type: "string" } },
      items: [{ type: "number" }],
      additionalProperties: { type: "boolean" },
      anyOf: [{ const: 1 }],
      oneOf: [{ const: 2 }],
      allOf: [{ const: 3 }],
    };
    expect(childSchemas(node)).toHaveLength(6);
  });
});
