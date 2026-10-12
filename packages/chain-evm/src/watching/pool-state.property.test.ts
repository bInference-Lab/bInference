import * as fc from "fast-check";
import { encodeAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { poolPrice } from "./pool-state.js";

const reserve = fc.bigInt({ min: 1n, max: 2n ** 112n - 1n });
const sqrtPrice = fc.bigInt({ min: 1n, max: 2n ** 160n - 1n });

const reservesAnswer = (reserve0: bigint, reserve1: bigint) =>
  encodeAbiParameters(
    [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
    [reserve0, reserve1, 0],
  );

const slot0Answer = (sqrtPriceX96: bigint) =>
  encodeAbiParameters(
    [
      { type: "uint160" },
      { type: "int24" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint32" },
      { type: "bool" },
    ],
    [sqrtPriceX96, 0, 0, 0, 0, 0, true],
  );

// The two sides of one pool price each other at the inverse price: their product is one.
const liquidityAnswer = encodeAbiParameters([{ type: "uint128" }], [10n ** 18n]);

function inverseOf(answer: `0x${string}`, kind: "v2" | "v3"): boolean {
  const answers = kind === "v2" ? [answer] : [answer, liquidityAnswer];
  const asToken0 = poolPrice({ kind, isToken0: true }, answers);
  const asToken1 = poolPrice({ kind, isToken0: false }, answers);
  return (
    asToken0.ok &&
    asToken1.ok &&
    asToken0.value.numerator * asToken1.value.numerator ===
      asToken0.value.denominator * asToken1.value.denominator
  );
}

describe("pool prices, for any reserves and any current price", () => {
  it("price a pair's two tokens at inverse prices above zero", () => {
    fc.assert(
      fc.property(reserve, reserve, (reserve0: bigint, reserve1: bigint) => {
        expect(inverseOf(reservesAnswer(reserve0, reserve1), "v2")).toBe(true);
      }),
    );
  });

  it("price a v3 pool's two tokens at inverse prices above zero", () => {
    fc.assert(
      fc.property(sqrtPrice, (sqrtPriceX96: bigint) => {
        expect(inverseOf(slot0Answer(sqrtPriceX96), "v3")).toBe(true);
      }),
    );
  });

  it("price token0 of a v2 pair at exactly its other reserve over its own", () => {
    fc.assert(
      fc.property(reserve, reserve, (reserve0: bigint, reserve1: bigint) => {
        const price = poolPrice({ kind: "v2", isToken0: true }, [
          reservesAnswer(reserve0, reserve1),
        ]);
        expect(price).toStrictEqual({
          ok: true,
          value: { numerator: reserve1, denominator: reserve0 },
        });
      }),
    );
  });
});
