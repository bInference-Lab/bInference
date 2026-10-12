import { describe, expect, it } from "vitest";
import { builtInPrice, isModelPriced, modelPriceOf, type PriceBook } from "./model-price.js";

const configured = { inputPerMTokUsd: 1n, outputPerMTokUsd: 2n, cachedPerMTokUsd: 3n };

const book: PriceBook = {
  providers: {
    claude: { kind: "anthropic" },
    gpt: { kind: "openai" },
    gateway: { kind: "binference" },
    local: { kind: "openai" },
  },
  prices: { "local/llama-4": configured, "claude/claude-opus-5-5": configured },
};

describe("a model's price", () => {
  it("reads the built-in table by the provider's kind and the model's id", () => {
    expect(builtInPrice("anthropic", "claude-opus-5-5")).toStrictEqual({
      inputPerMTokUsd: 4_000_000n,
      cachedPerMTokUsd: 200_000n,
      outputPerMTokUsd: 20_000_000n,
    });
    expect(builtInPrice("openai", "claude-opus-5-5")).toBeUndefined();
    expect(builtInPrice("binference", "gpt-5")).toBeUndefined();
  });

  it("prices a dated snapshot as its alias, unless the snapshot has a price of its own", () => {
    expect(builtInPrice("anthropic", "claude-haiku-4-5-20251001")).toStrictEqual(
      builtInPrice("anthropic", "claude-haiku-4-5"),
    );
    expect(builtInPrice("openai", "gpt-4.1-2025-04-14")).toStrictEqual(
      builtInPrice("openai", "gpt-4.1"),
    );
    expect(builtInPrice("openai", "gpt-4o-2024-05-13")?.inputPerMTokUsd).toBe(5_000_000n);
  });

  it("takes the config's prices over the built-in table, and the table for the rest", () => {
    expect(modelPriceOf("claude/claude-opus-5-5", book)).toStrictEqual({
      price: configured,
      source: "config",
    });
    expect(modelPriceOf("gpt/gpt-5-mini", book)?.source).toBe("built_in");
    expect(modelPriceOf("local/llama-4", book)?.source).toBe("config");
    expect(modelPriceOf("local/qwen-9", book)).toBeUndefined();
    expect(modelPriceOf("nobody/gpt-5", book)).toBeUndefined();
  });

  it("knows the spend of a model with a price or a gateway that reports its cost", () => {
    const names = ["gateway/any-model", "gpt/gpt-5", "local/llama-4", "local/qwen-9", "gpt"];
    expect(names.map((name) => isModelPriced(name, book))).toStrictEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
