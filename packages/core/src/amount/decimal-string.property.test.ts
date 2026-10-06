import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decimalStringSchema } from "./decimal-string.js";

describe("decimalStringSchema", () => {
  it("decodes and encodes every unsigned 256-bit integer without a change", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }), (value) => {
        const text = z.encode(decimalStringSchema, value);
        expect(text).toBe(value.toString());
        expect(z.decode(decimalStringSchema, text)).toBe(value);
      }),
    );
  });

  it.each(["", "-1", "01", "1.5", "1e3", " 1", "0x10", "9".repeat(79)])("refuses %j", (text) => {
    expect(decimalStringSchema.safeParse(text).success).toBe(false);
  });
});
