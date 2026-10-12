import type { RuntimeModelPrice } from "../control/runtime-settings.schema.js";
import type { ModelUsage } from "../loop/model-event.js";
import type { ModelPrice } from "./model-price.js";

/** One call's cost and where it came from: the provider's own, a price, or none, which is $0. */
export interface UsageCost {
  readonly usdMicros: bigint;
  readonly source: "provider" | "price" | "none";
}

const tokensPerMillion = 1_000_000n;

// Every rate is taken four times so that the cache write's 1.25 times the input price stays whole.
const scale = 4n;

// The rates of a call's prompt size: the long-prompt price once the input passes its threshold.
function ratesFor(
  price: ModelPrice,
  promptTokens: number,
): RuntimeModelPrice & {
  readonly cacheWritePerMTokUsd?: bigint;
} {
  const long = price.longPrompt;
  return long !== undefined && promptTokens > long.overTokens ? long.price : price;
}

const atLeastZero = (value: bigint): bigint => (value > 0n ? value : 0n);

/**
 * What one call cost at a price, in micro-dollars, rounded up so the budget never counts less
 * than the provider charges (runtime spec, section 8.3). `inputTokens` counts the whole input:
 * the tokens read from the cache (`cachedTokens`) and written to it (`cacheWriteTokens`) are taken
 * out of it and priced at their own rates, a write at 1.25 times the input price unless the price
 * names one.
 */
export function costAtPrice(usage: ModelUsage, price: ModelPrice): bigint {
  const rates = ratesFor(price, usage.inputTokens);
  const read = BigInt(usage.cachedTokens);
  const written = BigInt(usage.cacheWriteTokens ?? 0);
  const plain = atLeastZero(BigInt(usage.inputTokens) - read - written);
  const writeRate =
    rates.cacheWritePerMTokUsd === undefined
      ? rates.inputPerMTokUsd * 5n
      : rates.cacheWritePerMTokUsd * scale;
  const scaled =
    plain * rates.inputPerMTokUsd * scale +
    written * writeRate +
    read * rates.cachedPerMTokUsd * scale +
    BigInt(usage.outputTokens) * rates.outputPerMTokUsd * scale;
  const divisor = tokensPerMillion * scale;
  return (scaled + divisor - 1n) / divisor;
}

/**
 * What one model call cost (runtime spec, section 8.3): the provider's own cost when it reports
 * one, else the model's price applied to its tokens, else nothing, which counts $0.
 */
export function usageCost(usage: ModelUsage, price: ModelPrice | undefined): UsageCost {
  if (usage.usdMicros !== undefined) {
    return { usdMicros: usage.usdMicros, source: "provider" };
  }
  return price === undefined
    ? { usdMicros: 0n, source: "none" }
    : { usdMicros: costAtPrice(usage, price), source: "price" };
}
