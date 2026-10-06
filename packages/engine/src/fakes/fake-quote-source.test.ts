import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import { type Bps, type Id, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import { quoteSourceContract } from "../contracts/quote-source-contract.js";
import { createFakeQuoteSource } from "./fake-quote-source.js";

const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;
const quotable = "int_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"int">;
const unquotable = "int_0190f1c2-3b4c-7d5e-8f60-000000000000" as Id<"int">;
const built: BuiltQuote = {
  quote: {
    route: [{ venue: "venue-a", shareBps: 10_000 as Bps }],
    amountIn: { asset: coin, base: 10n ** 17n },
    expectedOut: { asset: token, base: 1_010_000n },
    minOut: { asset: token, base: 1_000_000n },
    priceImpactBps: 8 as Bps,
    gas: { asset: coin, base: 10n ** 13n },
    quotedAt: 20_000,
    expiresAt: 80_000,
  },
  steps: [{ chain: "fake:1" as ChainRef, from: "fake:1:wallet" as AccountRef, payload: "0x01" }],
};

describe("fake quote source", () => {
  it.each(
    quoteSourceContract({
      create: () => ({
        source: createFakeQuoteSource(new Map([[quotable, ok(built)]])),
        quotable,
        unquotable,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("records the intents it was asked to quote again", async () => {
    const source = createFakeQuoteSource(new Map());
    const live = { signal: new AbortController().signal };
    await source.requote(unquotable, live);
    await source.requote(quotable, live);
    expect(source.asked()).toStrictEqual([unquotable, quotable]);
  });

  it("keeps only the last 1,000 intents it was asked for", async () => {
    const source = createFakeQuoteSource(new Map());
    const live = { signal: new AbortController().signal };
    const intents = [unquotable, ...Array.from({ length: 1_000 }, () => quotable)];
    await Promise.all(intents.map(async (intent) => source.requote(intent, live)));
    expect(source.asked()).toHaveLength(1_000);
    expect(source.asked()).not.toContain(unquotable);
  });
});
