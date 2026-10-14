import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BuyTerms, buyOut, type CurveTerms, sellOut } from "./curve-math.js";

// The verified curve's arithmetic, written as its source spells it, step by step: the library's
// `getAmountOut` with a fee of 0, and the buy and sell bodies around it. Undefined where it reverts.
const basisPoints = 10_000n;

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint | undefined {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) {
    return undefined;
  }
  const amountInWithFee = amountIn * (basisPoints - 0n);
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * basisPoints + amountInWithFee;
  const amountOut = numerator / denominator;
  return amountOut === 0n ? undefined : amountOut;
}

function verifiedBuy(terms: BuyTerms, received: bigint): bigint | undefined {
  let snipeTaxBps = terms.snipeTaxBps;
  if (snipeTaxBps !== 0n) {
    const maxSnipeTaxBps = basisPoints - terms.feeBps - terms.creatorTaxBps - 100n;
    if (maxSnipeTaxBps < 0n) {
      return undefined;
    }
    snipeTaxBps = snipeTaxBps > maxSnipeTaxBps ? maxSnipeTaxBps : snipeTaxBps;
  }
  const fee = (received * terms.feeBps) / basisPoints;
  const tax = (received * terms.creatorTaxBps) / basisPoints;
  const snipeTax = (received * snipeTaxBps) / basisPoints;
  return getAmountOut(received - fee - tax - snipeTax, terms.quoteReserve, terms.tokenReserve);
}

function verifiedSell(terms: CurveTerms, tokensIn: bigint): bigint | undefined {
  const grossQuoteOut = getAmountOut(tokensIn, terms.tokenReserve, terms.quoteReserve);
  if (grossQuoteOut === undefined) {
    return undefined;
  }
  const fee = (grossQuoteOut * terms.feeBps) / basisPoints;
  const tax = (grossQuoteOut * terms.creatorTaxBps) / basisPoints;
  return grossQuoteOut - fee - tax;
}

// The constant product before and after a buy, the tokens it gets, and a bound they stay below:
// the token reserve, or 1 for a buy the curve refuses, which leaves the curve as it was.
function productsOf(asked: BuyTerms, quoteIn: bigint) {
  const bought = buyOut(asked, quoteIn);
  const before = asked.quoteReserve * asked.tokenReserve;
  if (bought === undefined) {
    return { before, after: before, tokensOut: 0n, bound: 1n };
  }
  const net = quoteIn - bought.taxPaid - (quoteIn * asked.feeBps) / basisPoints;
  const after = (asked.quoteReserve + net) * (asked.tokenReserve - bought.tokensOut);
  return { before, after, tokensOut: bought.tokensOut, bound: asked.tokenReserve };
}

// Reserves and amounts across the range a launch moves through and beyond: up to 10^30 base units,
// with fees and taxes up to the factory's 20% cap and snipe taxes up to its 99% start.
const units = fc.bigInt({ min: 0n, max: 10n ** 30n });
const terms = fc.record({
  quoteReserve: units,
  tokenReserve: units,
  feeBps: fc.bigInt({ min: 0n, max: 1_000n }),
  creatorTaxBps: fc.bigInt({ min: 0n, max: 1_000n }),
  snipeTaxBps: fc.bigInt({ min: 0n, max: 9_900n }),
});

describe("curve math against the verified curve", () => {
  it("buys, to the wei, what the curve's own arithmetic gives, and refuses where it reverts", () => {
    fc.assert(
      fc.property(terms, units, (asked, quoteIn) => {
        expect(buyOut(asked, quoteIn)?.tokensOut).toBe(verifiedBuy(asked, quoteIn));
      }),
    );
  });

  it("sells, to the wei, what the curve's own arithmetic gives, and refuses where it reverts", () => {
    fc.assert(
      fc.property(terms, units, (asked, tokensIn) => {
        expect(sellOut(asked, tokensIn)?.quoteOut).toBe(verifiedSell(asked, tokensIn));
      }),
    );
  });

  it("never lowers the curve's constant product, and never sells its whole reserve", () => {
    fc.assert(
      fc.property(terms, units, (asked, quoteIn) => {
        const { before, after, tokensOut, bound } = productsOf(asked, quoteIn);
        expect(after).toBeGreaterThanOrEqual(before);
        expect(tokensOut).toBeLessThan(bound);
      }),
    );
  });
});
