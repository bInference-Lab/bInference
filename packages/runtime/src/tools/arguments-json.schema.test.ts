import { decimalStringSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseArgumentsJson } from "./arguments-json.schema.js";

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

  it("leaves safe integers, fractions, exponents and strings as a plain parse gives them", () => {
    expect(
      parseArgumentsJson('{"a":9007199254740991,"b":0.5,"c":1e21,"d":"9007199254740993","e":-0}'),
    ).toStrictEqual({
      ok: true,
      value: { a: 9007199254740991, b: 0.5, c: 1e21, d: "9007199254740993", e: -0 },
    });
  });

  it("reads empty text as an empty object", () => {
    expect(parseArgumentsJson("  ")).toStrictEqual({ ok: true, value: {} });
  });

  it.each(["{not json", '{"a":1e400}', '{"a":1', "[1,]", "undefined"])("refuses %s", (text) => {
    expect(parseArgumentsJson(text)).toStrictEqual({ ok: false, error: "not_json" });
  });

  it("keeps every amount of up to 256 bits exact, as a number or as its digits", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }), (amount) => {
        expect(amountOf(`{"amountBase":${amount.toString()}}`)).toBe(amount);
      }),
    );
  });
});
