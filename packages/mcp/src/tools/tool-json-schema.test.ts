import { describeOperations, type JsonSchema, mcpTools } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { kindFieldsText } from "./kind-fields.js";
import { toolJsonSchema } from "./tool-json-schema.js";

const amount = { type: "object", properties: { base: { type: "string" } }, required: ["base"] };
const address = { type: "object", properties: { address: { type: "string" } } };

// Two requests as zod writes a discriminated union of them.
const requestUnion: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  oneOf: [
    {
      type: "object",
      properties: {
        agent: { type: "string" },
        kind: { type: "string", const: "swap" },
        to: { type: "string" },
        amount: { anyOf: [amount, { type: "string" }] },
      },
      required: ["agent", "kind", "to", "amount"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        agent: { type: "string" },
        kind: { type: "string", const: "send" },
        to: address,
        amount,
        note: { type: "string" },
      },
      required: ["agent", "kind", "amount", "to"],
      additionalProperties: false,
    },
  ],
};

const described = new Map(describeOperations().operations.map((item) => [item.name, item.args]));

function argsOf(operation: string): JsonSchema {
  return described.get(operation) ?? {};
}

interface Variant {
  readonly kind: string;
  readonly fields: readonly string[];
}

function unionOf(variants: readonly Variant[]): JsonSchema {
  return {
    oneOf: variants.map((item) => ({
      type: "object",
      properties: {
        kind: { type: "string", const: item.kind },
        ...Object.fromEntries(item.fields.map((field) => [field, { type: "number" }])),
      },
      required: ["kind", ...item.fields],
    })),
  };
}

const variantArbitrary = fc.record({
  kind: fc.string({ minLength: 1, maxLength: 8 }),
  fields: fc.uniqueArray(fc.constantFrom("a", "b", "c", "d"), { maxLength: 4 }),
});

describe("toolJsonSchema", () => {
  it("returns an args schema with an object at the root as it is", () => {
    const args = { type: "object", properties: { asset: { type: "string" } }, required: ["asset"] };
    expect(toolJsonSchema(args)).toBe(args);
  });

  it("merges a union of requests into one object that requires what every kind requires", () => {
    expect(toolJsonSchema(requestUnion)).toStrictEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        agent: { type: "string" },
        kind: { type: "string", enum: ["swap", "send"] },
        to: { anyOf: [{ type: "string" }, address] },
        amount: { anyOf: [amount, { type: "string" }] },
        note: { type: "string" },
      },
      required: ["agent", "kind", "to", "amount"],
      additionalProperties: false,
    });
  });

  it("gives every tool of the protocol's table an object root without a union", () => {
    const roots = mcpTools.map((tool) => toolJsonSchema(argsOf(tool.operation)));
    expect(roots.map((schema) => schema["type"])).toStrictEqual(mcpTools.map(() => "object"));
    const keys = roots.flatMap((schema) => Object.keys(schema));
    expect(keys.filter((key) => key.endsWith("Of"))).toStrictEqual([]);
  });

  it("keeps every field of any union of objects and requires only those all kinds share", () => {
    fc.assert(
      fc.property(variantArbitrary, fc.array(variantArbitrary, { maxLength: 4 }), (first, rest) => {
        const schema = toolJsonSchema(unionOf([first, ...rest]));
        const fields = new Set(["kind", ...[first, ...rest].flatMap((item) => item.fields)]);
        const shared = first.fields.filter((field) =>
          rest.every((item) => item.fields.includes(field)),
        );
        expect(new Set(Object.keys(schema["properties"] as object))).toStrictEqual(fields);
        expect(schema["required"]).toStrictEqual(["kind", ...shared]);
      }),
    );
  });
});

describe("kindFieldsText", () => {
  it("says which fields each kind adds to the fields every kind takes", () => {
    expect(kindFieldsText(requestUnion)).toBe(
      "Every kind takes agent. Each kind adds: swap: to, amount; send: to {address?}, amount {base}, note?.",
    );
  });

  it("says nothing for an args schema of one object", () => {
    expect(kindFieldsText(argsOf("portfolio/get"))).toBeUndefined();
  });

  it("names the fields of each kind of intent request and auto order", () => {
    expect(kindFieldsText(argsOf("intent/propose"))).toContain(
      "Every kind takes agent, wallet?, reason. Each kind adds: swap: from, to, amount, maxSlippageBps?;",
    );
    expect(kindFieldsText(argsOf("order/create"))).toContain("trailing: trigger {distanceBps};");
  });
});
