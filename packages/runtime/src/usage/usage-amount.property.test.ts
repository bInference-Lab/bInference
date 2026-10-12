import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ModelUsage } from "../loop/model-event.js";
import type { ModelPrice } from "./model-price.js";
import { costAtPrice, usageCost } from "./usage-amount.js";

const rate = fc.bigInt({ min: 0n, max: 200_000_000n });
const count = fc.integer({ min: 0, max: 2_000_000 });

const prices: fc.Arbitrary<ModelPrice> = fc.record(
  {
    inputPerMTokUsd: rate,
    outputPerMTokUsd: rate,
    cachedPerMTokUsd: rate,
    cacheWritePerMTokUsd: rate,
  },
  { requiredKeys: ["inputPerMTokUsd", "outputPerMTokUsd", "cachedPerMTokUsd"] },
);

// The cached and written tokens are parts of the whole input, as both transports count them.
const usages: fc.Arbitrary<ModelUsage> = fc
  .record({ plain: count, cached: count, written: count, output: count })
  .map(({ plain, cached, written, output }) => ({
    inputTokens: plain + cached + written,
    outputTokens: output,
    cachedTokens: cached,
    cacheWriteTokens: written,
  }));

// The exact cost in micro-dollars times four million, worked out apart from the module.
function exactTimesFourMillion(usage: ModelUsage, price: ModelPrice): bigint {
  const written = BigInt(usage.cacheWriteTokens ?? 0);
  const cached = BigInt(usage.cachedTokens);
  const plain = BigInt(usage.inputTokens) - cached - written;
  const writeTimesFour = (price.cacheWritePerMTokUsd ?? 0n) * 4n;
  const write =
    price.cacheWritePerMTokUsd === undefined ? price.inputPerMTokUsd * 5n : writeTimesFour;
  return (
    4n * plain * price.inputPerMTokUsd +
    written * write +
    4n * cached * price.cachedPerMTokUsd +
    4n * BigInt(usage.outputTokens) * price.outputPerMTokUsd
  );
}

const fourMillion = 4_000_000n;

describe("a model call's cost, for every usage and price", () => {
  it("is never below the exact cost, and less than one micro-dollar above it", () => {
    fc.assert(
      fc.property(usages, prices, (usage, price) => {
        const exact = exactTimesFourMillion(usage, price);
        const cost = costAtPrice(usage, price) * fourMillion;
        expect(cost).toBeGreaterThanOrEqual(exact);
        expect(cost - exact).toBeLessThan(fourMillion);
      }),
      { numRuns: 2_000 },
    );
  });

  it("never falls when the call used more output", () => {
    fc.assert(
      fc.property(usages, prices, count, (usage, price, more) => {
        const larger = { ...usage, outputTokens: usage.outputTokens + more };
        expect(costAtPrice(larger, price)).toBeGreaterThanOrEqual(costAtPrice(usage, price));
      }),
    );
  });

  it("counts the provider's own cost as it is, whatever the price", () => {
    fc.assert(
      fc.property(usages, prices, fc.bigInt({ min: 0n, max: 10n ** 12n }), (usage, price, own) => {
        expect(usageCost({ ...usage, usdMicros: own }, price)).toStrictEqual({
          usdMicros: own,
          source: "provider",
        });
      }),
    );
  });
});
