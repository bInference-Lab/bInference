import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { amountSchema } from "./amount.js";

const asset = fc
  .stringMatching(/^0x[0-9a-fA-F]{40}$/)
  .map((address) => `eip155:56/erc20:${address}`);

describe("amount wire format", () => {
  it("decodes and encodes any amount without a change", () => {
    fc.assert(
      fc.property(asset, fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }), (assetText, base) => {
        const wire = { asset: assetText, base: base.toString() };
        const amount = z.decode(amountSchema, wire);
        expect(amount.base).toBe(base);
        expect(z.encode(amountSchema, amount)).toStrictEqual(wire);
      }),
    );
  });

  it.each<[string, Readonly<Record<string, string | number>>]>([
    ["a number for base units", { asset: "eip155:56/slip44:714", base: 1 }],
    ["a negative amount", { asset: "eip155:56/slip44:714", base: "-1" }],
    ["a decimal point", { asset: "eip155:56/slip44:714", base: "1.5" }],
    ["a malformed asset", { asset: "BNB", base: "1" }],
    ["an extra field", { asset: "eip155:56/slip44:714", base: "1", usd: "2" }],
  ])("refuses %s", (_case, wire) => {
    expect(amountSchema.safeParse(wire).success).toBe(false);
  });
});
