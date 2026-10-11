import { decimalStringSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  maxArgumentsChars,
  maxArgumentsDepth,
  parseArgumentsJson,
} from "./arguments-json.schema.js";

// The amount a tool reads from parsed arguments: a safe integer stays a number, a larger one its digits.
function amountOf(text: string): bigint | undefined {
  const parsed = parseArgumentsJson(text);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return undefined;
  }
  const amount = "amountBase" in parsed.value ? parsed.value["amountBase"] : undefined;
  const digits = typeof amount === "number" ? String(amount) : amount;
  return decimalStringSchema.safeParse(digits).data;
}

describe("parseArgumentsJson", () => {
  it("keeps an integer literal past 2^53 as its exact digits", () => {
    expect(parseArgumentsJson('{"amountBase":9007199254740993}')).toStrictEqual({
      ok: true,
      value: { amountBase: "9007199254740993" },
    });
  });

  it("keeps big integers exact at any depth, negative ones too", () => {
    expect(
      parseArgumentsJson('{"legs":[{"in":123456789012345678901234567890},-90071992547409930]}'),
    ).toStrictEqual({
      ok: true,
      value: { legs: [{ in: "123456789012345678901234567890" }, "-90071992547409930"] },
    });
  });

  it("leaves safe integers, fractions and strings as a plain parse gives them", () => {
    expect(
      parseArgumentsJson('{"a":9007199254740991,"b":0.5,"d":"9007199254740993","e":-0}'),
    ).toStrictEqual({
      ok: true,
      value: { a: 9007199254740991, b: 0.5, d: "9007199254740993", e: -0 },
    });
  });

  it("reads empty text as an empty object", () => {
    expect(parseArgumentsJson("  ")).toStrictEqual({ ok: true, value: {} });
  });

  it.each(["{not json", '{"a":1e400}', '{"a":1', "[1,]", "undefined"])("refuses %s", (text) => {
    expect(parseArgumentsJson(text)).toStrictEqual({ ok: false, error: "not_json" });
  });

  it("refuses arguments nested deeper than the limit, without overflowing the stack", () => {
    const deep = `{"a":${"[".repeat(2_000)}${"]".repeat(2_000)}}`;
    expect(parseArgumentsJson(deep)).toStrictEqual({ ok: false, error: "too_deep" });
  });

  it("takes arguments nested to the limit", () => {
    const depth = maxArgumentsDepth - 1;
    const nested = `{"a":${"[".repeat(depth)}${"]".repeat(depth)}}`;
    expect(parseArgumentsJson(nested).ok).toBe(true);
  });

  it("refuses arguments longer than the limit before parsing them", () => {
    const long = `{"a":"${"x".repeat(maxArgumentsChars)}"}`;
    expect(parseArgumentsJson(long)).toStrictEqual({ ok: false, error: "too_large" });
  });

  it("counts no bracket inside a string toward the depth", () => {
    const text = JSON.stringify({ note: "[".repeat(500), 'q"[': 1 });
    expect(parseArgumentsJson(text).ok).toBe(true);
  });

  it.each([
    '{"amountBase":"1","amountBase":"1000"}',
    '{"legs":[{"to":"a","to":"b"}]}',
    String.raw`{"a\u0062":1,"ab":2}`,
  ])("refuses a key written twice in one object: %s", (text) => {
    expect(parseArgumentsJson(text)).toStrictEqual({ ok: false, error: "duplicate_key" });
  });

  it("takes the same key in different objects", () => {
    expect(parseArgumentsJson('{"a":{"k":1},"b":{"k":2}}').ok).toBe(true);
  });

  it.each([
    "9007199254740993.0",
    "9.007199254740993e15",
    "12345678901234567890e0",
    "-1e19",
    "1e21",
  ])("refuses %s: an integer past 2^53 not written as plain digits would be rounded", (number) => {
    expect(parseArgumentsJson(`{"n":${number}}`)).toStrictEqual({
      ok: false,
      error: "unsafe_number",
    });
  });

  it("takes fractions and exponents that stay below 2^53", () => {
    expect(parseArgumentsJson('{"a":1.5e3,"b":0.25,"c":2e-3}')).toStrictEqual({
      ok: true,
      value: { a: 1500, b: 0.25, c: 0.002 },
    });
  });

  it("keeps every amount of up to 256 bits exact, as a number or as its digits", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }), (amount) => {
        expect(amountOf(`{"amountBase":${amount.toString()}}`)).toBe(amount);
      }),
    );
  });
});
