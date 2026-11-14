import { assetRefSchema, type Venue } from "@binference/chain";
import { createFakeLaunchpad, createFakeSigner, createFakeVenue } from "@binference/chain/testing";
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
import { listedArchived, testAccount, testCall, testChains, testFacts } from "./test-engine.js";
import { createTokenReadHandlers } from "./token-read-handlers.js";

const swap = testSwap() as SwapRequest;
const unlisted = assetRefSchema.parse("fake:1/token:0x000000ff");
// A token on a chain the registry does not hold.
const offRegistry = assetRefSchema.parse(
  "eip155:999/erc20:0x00000000000000000000000000000000000000aa",
);

interface TokenReadsSetUp {
  /** The venues the agent may trade on, in its order; the fake venue alone when absent. */
  readonly venues?: readonly Venue[];
  /** What the unlisted test token answers on chain. */
  readonly facts?: ReadonlyMap<string, TokenFacts>;
  /** Lists the test agent as archived. */
  readonly isArchived?: boolean;
}

const noFacts: ReadonlyMap<string, TokenFacts> = new Map();

// The token reads over the given venues, with token facts that answer for the unlisted test token.
async function tokenReads(setUp: TokenReadsSetUp = {}) {
  const { venues = [createFakeVenue()], facts = noFacts, isArchived = false } = setUp;
  const clock = createManualClock(testNowMs);
  const chains = testChains(venues.map(({ id }) => id).filter((id) => id !== "fake-swap"));
  const stored = createMemoryAgentStore();
  const limits = { ...testLimits, venues: venues.map((venue) => venue.id) };
  await stored.create(testAgentDraft({ limits }), testCall({}));
  return createTokenReadHandlers({
    agents: isArchived ? listedArchived(stored) : stored,
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

const down = async (): Promise<never> => Promise.reject(new Error("rpc down"));

// The fake venue, with its quote or its build failing as a venue that does not answer.
function silent(part: "quote" | "build"): Venue {
  return { ...createFakeVenue(), [part]: down };
}

const rate = (numerator: bigint) => ({ numerator, denominator: 10n });

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

  it("take the venue with the best expected output, in whatever order the agent lists them", async () => {
    const better = otherVenue(rate(21n));
    const last = await tokenReads({ venues: [createFakeVenue(), better] });
    const first = await tokenReads({ venues: [better, createFakeVenue()] });
    const routes = [
      expectOk(await last["quote/get"](testCall(swap))).route,
      expectOk(await first["quote/get"](testCall(swap))).route,
    ];
    expect(routes.map((route) => route[0]?.venue)).toStrictEqual([otherVenueId, otherVenueId]);
  });

  it("take the first venue the agent lists when two quote the same output, as the money path ranks", async () => {
    const reads = await tokenReads({ venues: [otherVenue(rate(20n)), createFakeVenue()] });
    const quote = expectOk(await reads["quote/get"](testCall(swap)));
    expect(quote.route).toStrictEqual([{ venue: otherVenueId, shareBps: 10_000 }]);
  });

  it("answer no route when every quote is above the agent's maximum price impact", async () => {
    const reads = await tokenReads({
      venues: [createFakeVenue({ priceImpactBps: bpsSchema.parse(10_000) })],
    });
    await expect(reads["quote/get"](testCall(swap))).resolves.toStrictEqual(err("quote.no_route"));
  });

  it("answer venue down, which a caller may ask again, when no venue answers its quote", async () => {
    const reads = await tokenReads({ venues: [silent("quote")] });
    await expect(reads["quote/get"](testCall(swap))).resolves.toStrictEqual(
      err("quote.venue_down"),
    );
  });

  it("answer no route when one venue does not answer and the other cannot quote", async () => {
    const reads = await tokenReads({
      venues: [silent("quote"), { ...otherVenue(rate(20n)), quote: async () => err("no_route") }],
    });
    await expect(reads["quote/get"](testCall(swap))).resolves.toStrictEqual(err("quote.no_route"));
  });

  it("answer venue down when the venue it picked does not answer its build", async () => {
    const reads = await tokenReads({ venues: [silent("build")] });
    await expect(reads["quote/get"](testCall(swap))).resolves.toStrictEqual(
      err("quote.venue_down"),
    );
  });

  it("answer no route for a risk check of a token whose curve trades it against another asset", async () => {
    const curve = createFakeLaunchpad({ onCurve: [testToken], quoteAsset: unlisted });
    const reads = await tokenReads({ venues: [createFakeVenue(), curve] });
    await expect(reads["risk/check"](testCall({ asset: testToken }))).resolves.toStrictEqual(
      err("quote.no_route"),
    );
  });

  it("refuse a quote for an agent the install does not hold", async () => {
    const reads = await tokenReads();
    const stranger: SwapRequest = { ...swap, agent: fixtureId("agt", 59) };
    await expect(reads["quote/get"](testCall(stranger))).resolves.toStrictEqual(
      err("agent.not_found"),
    );
  });

  it("refuse a quote from a wallet that is not the agent's", async () => {
    const reads = await tokenReads();
    const elsewhere: SwapRequest = { ...swap, wallet: fixtureId("wal", 59) };
    await expect(reads["quote/get"](testCall(elsewhere))).resolves.toStrictEqual(
      err("wallet.not_found"),
    );
  });

  it("read a listed asset from the registry, verified", async () => {
    const reads = await tokenReads();
    const view = expectOk(await reads["asset/get"](testCall({ asset: testCoin })));
    expect(view).toMatchObject({ asset: testCoin, verified: true });
  });

  it("read an unlisted token on chain, unverified, and refuse one that answers nothing", async () => {
    const facts = new Map([[unlisted, { symbol: "TKN", name: "Token", decimals: 18 }]]);
    const reads = await tokenReads({ facts });
    const view = expectOk(await reads["asset/get"](testCall({ asset: unlisted })));
    expect(view).toStrictEqual({
      asset: unlisted,
      symbol: "TKN",
      name: "Token",
      decimals: 18,
      verified: false,
    });
    const silentFacts = await tokenReads();
    await expect(silentFacts["asset/get"](testCall({ asset: unlisted }))).resolves.toStrictEqual(
      err("asset.unreadable"),
    );
  });

  it("refuse an asset or a risk check of a token on no chain the registry holds", async () => {
    const reads = await tokenReads();
    expect([
      await reads["asset/get"](testCall({ asset: offRegistry })),
      await reads["risk/check"](testCall({ asset: offRegistry, agent: testAgent })),
    ]).toStrictEqual([err("protocol.bad_args"), err("protocol.bad_args")]);
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

  it("refuse a risk check for an agent the install does not hold, or with no agent left", async () => {
    const reads = await tokenReads();
    const archived = await tokenReads({ isArchived: true });
    expect([
      await reads["risk/check"](testCall({ asset: testToken, agent: fixtureId("agt", 59) })),
      await archived["risk/check"](testCall({ asset: testToken })),
    ]).toStrictEqual([err("agent.not_found"), err("agent.not_found")]);
  });

  it("answer no route when no venue quotes the sample buy", async () => {
    const reads = await tokenReads({
      venues: [createFakeVenue({ priceImpactBps: bpsSchema.parse(10_000) })],
    });
    await expect(reads["risk/check"](testCall({ asset: testToken }))).resolves.toStrictEqual(
      err("quote.no_route"),
    );
  });
});
