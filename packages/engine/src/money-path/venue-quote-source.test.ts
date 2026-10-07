import { createFakeSigner, createFakeVenue } from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { quoteSourceContract } from "../contracts/quote-source-contract.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { testAgentDraft, testNewIntent, testNowMs, testWallet } from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import type { QuoteSource } from "../ports.js";
import { createVenueHost } from "../venues/venue-host.js";
import { createVenueQuoteSource } from "./venue-quote-source.js";

const live = { signal: new AbortController().signal };
const quotable = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const unquotable = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"int">;

// Quotes the stored swap through the fake venue; each call waits for the intent to be stored.
function quoting(wallets = new Map([[testWallet, testAccount]])): QuoteSource {
  const clock = createManualClock(testNowMs);
  const stores = createMemoryEngineStores();
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids: createIdSource({ clock, random: createSeededRandom(9) }),
    publish: () => undefined,
  });
  const chains = testChains();
  const source = createVenueQuoteSource({
    stored,
    custody: createFakeSigner(wallets),
    host: createVenueHost({ venues: [createFakeVenue()], chains, clock, callTimeoutMs: 5_000 }),
    chains,
  });
  const ready = (async () => {
    await stores.agents.create(testAgentDraft(), live);
    await stored.create(testNewIntent(quotable), live);
  })();
  return {
    requote: async (intent, options) => {
      await ready;
      return source.requote(intent, options);
    },
  };
}

describe("venue quote source", () => {
  it.each(quoteSourceContract({ create: () => ({ source: quoting(), quotable, unquotable }) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("answers a wallet the custodian no longer holds as a venue that is down", async () => {
    await expect(quoting(new Map()).requote(quotable, live)).resolves.toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });
});
