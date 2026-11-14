import type { JsonSchemaNode } from "@binference/core";
import { describe, expect, it } from "vitest";
import { readArguments } from "./read-arguments.js";
import { repairValues } from "./repair-values.js";

const schema: JsonSchemaNode = {
  type: "object",
  properties: {
    count: { type: "integer" },
    need: { type: "integer" },
    either: { anyOf: [{ type: "integer" }, { type: "string" }] },
    maybe: { anyOf: [{ type: "integer" }, { type: "null" }] },
    kind: { type: "string", enum: ["a", null] },
    label: { type: "string" },
    inner: {
      type: "object",
      properties: { size: { type: "integer" } },
      required: [],
    },
    rows: { type: "array", items: { type: "object", properties: { at: { type: "integer" } } } },
  },
  required: ["need"],
};

function repaired(text: string): { readonly text: string; readonly steps: readonly string[] } {
  const read = readArguments(text) ?? {};
  const fixed = repairValues(read, schema);
  return { text: JSON.stringify(fixed.value), steps: fixed.steps };
}

describe("repairValues", () => {
  it("reads integers written as plain digits in objects and lists the schema names", () => {
    expect(repaired('{"count":"7","inner":{"size":"0"},"rows":[{"at":"12"}]}')).toStrictEqual({
      text: '{"count":7,"inner":{"size":0},"rows":[{"at":12}]}',
      steps: ["integer_string"],
    });
  });

  it("leaves out null for an optional field that takes no null", () => {
    expect(repaired('{"count":null,"label":null,"need":1}')).toStrictEqual({
      text: '{"need":1}',
      steps: ["null_optional"],
    });
  });

  it.each([
    { why: "a field under a union", text: '{"either":"3"}' },
    { why: "a number where a string is asked", text: '{"label":3}' },
    { why: "digits past 2^53", text: '{"count":"9007199254740993"}' },
    { why: "digits with a sign or a point", text: '{"count":"-3","need":"1.0"}' },
    { why: "digits with a leading zero", text: '{"count":"07"}' },
    { why: "null for a required field", text: '{"need":null}' },
    { why: "null where a union takes it", text: '{"maybe":null}' },
    { why: "null among a field's values", text: '{"kind":null}' },
    { why: "a field the schema does not name", text: '{"other":"5","more":null}' },
  ])("changes nothing for $why", ({ text }) => {
    expect(repaired(text)).toStrictEqual({ text, steps: [] });
  });
});
