import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PairReserves, pairAmountOut, sqrtFloor, swapToPrice } from "./pair-swap.js";

const reserve = fc.bigInt({ min: 10n ** 15n, max: 10n ** 30n });
// A target within a fifth of the pool's price, in hundredths of a basis point.
const targetMove = fc.integer({ min: -2_000_000, max: 2_000_000 }).filter((value) => value !== 0);
const scale = 100_000_000n;

function targetOf(reserves: PairReserves, hundredths: number) {
  return {
    numerator: reserves.reserveQuote * (scale + BigInt(hundredths)),
    denominator: reserves.reserveToken * scale,
  };
}

// Where a swap of `amountIn` on `side` leaves the pair's price against the target: above zero
// over it, below zero under it.
function gapAfter(
  reserves: PairReserves,
  move: { readonly side: "buy" | "sell"; readonly hundredths: number },
  amountIn: bigint,
): bigint {
  const target = targetOf(reserves, move.hundredths);
  const { reserveToken, reserveQuote } = reserves;
  const isBuy = move.side === "buy";
  const out = isBuy
    ? pairAmountOut(amountIn, reserveQuote, reserveToken)
    : pairAmountOut(amountIn, reserveToken, reserveQuote);
  const token = isBuy ? reserveToken - out : reserveToken + amountIn;
  const quote = isBuy ? reserveQuote + amountIn : reserveQuote - out;
  return quote * target.denominator - target.numerator * token;
}

// The swap reaches the target, and the same swap with one unit less does not.
function isLeastReaching(reserves: PairReserves, hundredths: number): boolean {
  const swap = swapToPrice(reserves, targetOf(reserves, hundredths));
  if (swap === undefined) {
    return false;
  }
  const move = { side: swap.side, hundredths };
  const reached = gapAfter(reserves, move, swap.amountIn);
  const short = gapAfter(reserves, move, swap.amountIn - 1n);
  const isRightSide = swap.side === (hundredths > 0 ? "buy" : "sell");
  return (
    isRightSide && (swap.side === "buy" ? reached >= 0n && short < 0n : reached <= 0n && short > 0n)
  );
}

// The swap pays out what the pair's own formula pays, never its whole reserve of that side.
function paysAsThePair(reserves: PairReserves, hundredths: number): boolean {
  const swap = swapToPrice(reserves, targetOf(reserves, hundredths));
  if (swap === undefined) {
    return false;
  }
  const isBuy = swap.side === "buy";
  const reserveIn = isBuy ? reserves.reserveQuote : reserves.reserveToken;
  const reserveOut = isBuy ? reserves.reserveToken : reserves.reserveQuote;
  return (
    swap.amountOut === pairAmountOut(swap.amountIn, reserveIn, reserveOut) &&
    swap.amountOut < reserveOut
  );
}

function isFloorRoot(value: bigint): boolean {
  const root = sqrtFloor(value);
  return root * root <= value && (root + 1n) * (root + 1n) > value;
}

describe("swapToPrice, for any reserves and any target within a fifth of the price", () => {
  it("reaches the target and no amount one unit smaller does", () => {
    fc.assert(
      fc.property(reserve, reserve, targetMove, (reserveToken, reserveQuote, hundredths) => {
        expect(isLeastReaching({ reserveToken, reserveQuote }, hundredths)).toBe(true);
      }),
    );
  });

  it("pays out what the pair's own formula pays and never its whole reserve", () => {
    fc.assert(
      fc.property(reserve, reserve, targetMove, (reserveToken, reserveQuote, hundredths) => {
        expect(paysAsThePair({ reserveToken, reserveQuote }, hundredths)).toBe(true);
      }),
    );
  });
});

describe("sqrtFloor, for any value", () => {
  it("answers the largest root whose square does not pass the value", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n }), (value) => {
        expect(isFloorRoot(value)).toBe(true);
      }),
    );
  });
});
