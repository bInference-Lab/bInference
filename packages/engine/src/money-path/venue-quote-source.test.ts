import { createFakeSigner, createFakeVenue } from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { quoteSourceContract } from "../contracts/quote-source-contract.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import {
  testAgent,
  testAgentDraft,
  testLimits,
  testNewIntent,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import { testAccount, testChains, testFacts } from "../operations/test-engine.js";
import type { QuoteSource } from "../ports.js";
import { createVenueHost } from "../venues/venue-host.js";
import { otherVenue, otherVenueId } from "./test-routes.js";
import { createVenueQuoteSource } from "./venue-quote-source.js";

const live = { signal: new AbortController().signal };
const quotable = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const unquotable = "int_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"int">;

// Quotes the stored swap through the fake venue, or through both venues of an agent that allows
// the other one too; each call waits for the intent to be stored.
function quoting(
  wallets = new Map([[testWallet, testAccount]]),
  other?: ReturnType<typeof otherVenue>,
): QuoteSource {
  const clock = createManualClock(testNowMs);
  const stores = createMemoryEngineStores();
  const stored = createStoredIntents({
    intents: stores.intents,
    agents: stores.agents,
    ids: createIdSource({ clock, random: createSeededRandom(9) }),
    publish: () => undefined,
  });
  const chains = testChains(other === undefined ? [] : [otherVenueId]);
  const venues = other === undefined ? [createFakeVenue()] : [createFakeVenue(), other];
  const limits = { ...testLimits, venues: venues.map((venue) => venue.id) };
  const source = createVenueQuoteSource({
    stored,
    custody: createFakeSigner(wallets),
    wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet]]]), testFacts),
    host: createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 }),
    simulator: createQuoteSimulator(() => undefined),
    prices: createFakePriceSource(new Map()),
    chains,
    clock,
  });
  const ready = (async () => {
    await stores.agents.create(testAgentDraft({ limits }), live);
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

  it("quotes every venue the agent allows again and takes the best route", async () => {
    const other = otherVenue({ numerator: 21n, denominator: 10n });
    const requoted = await quoting(undefined, other).requote(quotable, live);
    expect(requoted).toMatchObject({
      ok: true,
      value: { quote: { route: [{ venue: otherVenueId }] } },
    });
  });
});
