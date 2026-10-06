import { describe, expect, it } from "vitest";
import { jsonValueSchema } from "./json-value.schema.js";
import { stableJson } from "./stable-json.js";

describe("stableJson", () => {
  it("writes the same text whatever order the keys came in", () => {
    const first = stableJson({ b: 1, a: { d: [true, null], c: "x" } });
    const second = stableJson({ a: { c: "x", d: [true, null] }, b: 1 });
    expect(first).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
    expect(second).toBe(first);
  });

  it("keeps the order of list items and escapes text as JSON does", () => {
    expect(stableJson(["b", "a", 'q"uote', "café"])).toBe('["b","a","q\\"uote","café"]');
  });

  it("writes scalars as JSON does", () => {
    expect([null, false, 0, -1.5, ""].map(stableJson)).toStrictEqual([
      "null",
      "false",
      "0",
      "-1.5",
      '""',
    ]);
  });
});

describe("jsonValueSchema", () => {
  it("accepts a nested document", () => {
    const document = { a: [1, "two", { three: null }], b: true };
    expect(jsonValueSchema.parse(document)).toStrictEqual(document);
  });

  it.each([[undefined], [1n], [Number.NaN], [() => 1]])("refuses %s", (value) => {
    expect(jsonValueSchema.safeParse(value).success).toBe(false);
  });
});
