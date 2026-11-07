import { assetRefSchema } from "@binference/chain";
import { createFakeSigner, createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, err } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { SwapRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakeRiskCheck } from "../fakes/fake-risk-check.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import {
  expectOk,
  testAgent,
  testAgentDraft,
  testCoin,
  testLimits,
  testNowMs,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { otherVenue, otherVenueId } from "../money-path/test-routes.js";
import type { TokenFacts } from "../money-path/token-facts.js";
import { createVenueHost } from "../venues/venue-host.js";
import { testAccount, testCall, testChains, testFacts } from "./test-engine.js";
import { createTokenReadHandlers } from "./token-read-handlers.js";

const swap = testSwap() as SwapRequest;
const unlisted = assetRefSchema.parse("fake:1/token:0x000000ff");

// The token reads over the fake venue, and the other one too when given, with token facts that
// answer for the unlisted test token.
async function tokenReads(
  venues: readonly ReturnType<typeof createFakeVenue>[] = [createFakeVenue()],
  facts: ReadonlyMap<string, TokenFacts> = new Map(),
) {
  const clock = createManualClock(testNowMs);
  const chains = testChains(venues.length > 1 ? [otherVenueId] : []);
  const agents = createMemoryAgentStore();
  const limits = { ...testLimits, venues: venues.map((venue) => venue.id) };
  await agents.create(testAgentDraft({ limits }), testCall({}));
  return createTokenReadHandlers({
    agents,
    chains,
    readTokenFacts: async (tokens) =>
      Promise.resolve(
        new Map(
          tokens.flatMap((token) => {
            const found = facts.get(token);
            return found === undefined ? [] : [[token, found] as const];
          }),
        ),
      ),
    quotes: {
      custody: createFakeSigner(new Map([[testWallet, testAccount]])),
      wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet]]]), testFacts),
      holdings: { held: async () => Promise.resolve(0n) },
      host: createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 }),
      chains,
      clock,
    },
    risk: createFakeRiskCheck({ chains, clock }),
  });
}

describe("the token reads", () => {
  it("quote a swap as its proposal would, built and checked, and store nothing", async () => {
    const reads = await tokenReads();
    const quote = expectOk(await reads["quote/get"](testCall(swap)));
    expect(quote).toMatchObject({
      route: [{ venue: "fake-swap" }],
      amountIn: { asset: testCoin, base: 1_000_000n },
      expectedOut: { asset: testToken },
    });
  });

  it("take the venue with the best expected output", async () => {
    const reads = await tokenReads([
      createFakeVenue(),
      otherVenue({ numerator: 21n, denominator: 10n }),
    ]);
    const quote = expectOk(await reads["quote/get"](testCall(swap)));
    expect(quote.route).toStrictEqual([{ venue: otherVenueId, shareBps: 10_000 }]);
  });

  it("answer no route when every quote is above the agent's maximum price impact", async () => {
    const reads = await tokenReads([createFakeVenue({ priceImpactBps: bpsSchema.parse(10_000) })]);
    await expect(reads["quote/get"](testCall(swap))).resolves.toStrictEqual(err("quote.no_route"));
  });

  it("refuse a quote for an agent the install does not hold", async () => {
    const reads = await tokenReads();
    const stranger: SwapRequest = { ...swap, agent: fixtureId("agt", 59) };
    await expect(reads["quote/get"](testCall(stranger))).resolves.toStrictEqual(
      err("agent.not_found"),
    );
  });

  it("read a listed asset from the registry, verified", async () => {
    const reads = await tokenReads();
    const view = expectOk(await reads["asset/get"](testCall({ asset: testCoin })));
    expect(view).toMatchObject({ asset: testCoin, verified: true });
  });

  it("read an unlisted token on chain, unverified, and refuse one that answers nothing", async () => {
    const facts = new Map([[unlisted, { symbol: "TKN", name: "Token", decimals: 18 }]]);
    const reads = await tokenReads(undefined, facts);
    const view = expectOk(await reads["asset/get"](testCall({ asset: unlisted })));
    expect(view).toStrictEqual({
      asset: unlisted,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      verified: false,
    });
    const silent = await tokenReads();
    await expect(silent["asset/get"](testCall({ asset: unlisted }))).resolves.toStrictEqual(
      err("asset.unreadable"),
    );
  });

  it("check a token's risk on the best quote of a sample buy for the agent", async () => {
    const reads = await tokenReads();
    const view = expectOk(
      await reads["risk/check"](testCall({ asset: testToken, agent: testAgent })),
    );
    expect(view).toMatchObject({ verdict: "pass", flags: [] });
  });

  it("check for the oldest agent when the call names none", async () => {
    const reads = await tokenReads();
    const view = expectOk(await reads["risk/check"](testCall({ asset: testToken })));
    expect(view.verdict).toBe("pass");
  });

  it("answer no route when no venue quotes the sample buy", async () => {
    const reads = await tokenReads([createFakeVenue({ priceImpactBps: bpsSchema.parse(10_000) })]);
    await expect(reads["risk/check"](testCall({ asset: testToken }))).resolves.toStrictEqual(
      err("quote.no_route"),
    );
  });
});
