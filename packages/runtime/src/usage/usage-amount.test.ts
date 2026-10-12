import { describe, expect, it } from "vitest";
import { builtInPrice } from "./model-price.js";
import { costAtPrice, usageCost } from "./usage-amount.js";

function priceOf(kind: "anthropic" | "openai", id: string) {
  const price = builtInPrice(kind, id);
  if (price === undefined) {
    throw new Error(`Expected a built-in price for ${id}.`);
  }
  return price;
}

describe("a model call's cost", () => {
  // Claude Sonnet 4.6 lists $3 input, $3.75 a 5-minute cache write, $0.30 a cache read and $15
  // output per million tokens. 12,000 input tokens, of which 8,000 read from the cache and 2,000
  // written to it, leave 2,000 plain: 2,000 x $3 + 2,000 x $3.75 + 8,000 x $0.30 + 500 x $15,
  // over a million, is $0.006 + $0.0075 + $0.0024 + $0.0075 = $0.0234.
  it("prices cache reads and writes apart, as worked out by hand", () => {
    const usage = {
      inputTokens: 12_000,
      outputTokens: 500,
      cachedTokens: 8_000,
      cacheWriteTokens: 2_000,
    };
    expect(costAtPrice(usage, priceOf("anthropic", "claude-sonnet-4-6"))).toBe(23_400n);
  });

  // GPT-5.4 mini lists $0.75 input, $0.075 cached input and $4.50 output: 3,000 plain input,
  // 7,000 cached and 1,000 output cost $0.00225 + $0.000525 + $0.0045 = $0.007275.
  it("prices a Chat Completions call's cached input at its own rate", () => {
    const usage = { inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 7_000 };
    expect(costAtPrice(usage, priceOf("openai", "gpt-5.4-mini"))).toBe(7_275n);
  });

  it("rounds a fraction of a micro-dollar up, so the budget never counts less", () => {
    const usage = { inputTokens: 1, outputTokens: 0, cachedTokens: 0 };
    expect(costAtPrice(usage, priceOf("anthropic", "claude-haiku-5-5"))).toBe(1n);
  });

  // Claude Haiku 5.5 charges $0.50 input and $2.50 output per million tokens once the prompt,
  // cache reads and writes included, is over 100,000 tokens: 100,001 plain tokens and 1,000
  // output cost $0.0500005 + $0.0025, rounded up to 52,501 micro-dollars.
  it("charges a long prompt's price once the whole input passes its threshold", () => {
    const short = { inputTokens: 100_000, outputTokens: 1_000, cachedTokens: 0 };
    const long = { ...short, inputTokens: 100_001 };
    const price = priceOf("anthropic", "claude-haiku-5-5");
    expect([costAtPrice(short, price), costAtPrice(long, price)]).toStrictEqual([10_500n, 52_501n]);
  });

  it("takes the provider's own cost over any price, and counts $0 with neither", () => {
    const usage = { inputTokens: 1_000, outputTokens: 1_000, cachedTokens: 0 };
    const price = priceOf("openai", "gpt-5");
    expect([
      usageCost({ ...usage, usdMicros: 42n }, price),
      usageCost(usage, price),
      usageCost(usage, undefined),
    ]).toStrictEqual([
      { usdMicros: 42n, source: "provider" },
      { usdMicros: 11_250n, source: "price" },
      { usdMicros: 0n, source: "none" },
    ]);
  });
});
