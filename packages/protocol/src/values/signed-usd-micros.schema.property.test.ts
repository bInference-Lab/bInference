import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { signedUsdMicrosSchema } from "./signed-usd-micros.schema.js";

describe("signedUsdMicrosSchema", () => {
  it("round-trips any profit or loss through its decimal string", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 200n), max: 2n ** 200n }), (value) => {
        const text = z.encode(signedUsdMicrosSchema, value);
        expect(text).toBe(value.toString());
        expect(z.decode(signedUsdMicrosSchema, text)).toBe(value);
      }),
    );
  });

  it.each(["-0", "01", "+1", "1.5", "", " 1", "1e6"])("refuses %j", (text) => {
    expect(signedUsdMicrosSchema.safeParse(text).success).toBe(false);
  });
});
