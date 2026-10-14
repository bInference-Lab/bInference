import {
  accountRefSchema,
  assetRefSchema,
  type TokenRiskReport,
  type Venue,
} from "@binference/chain";
import {
  createFakeLaunchpad,
  createFakeRiskSource,
  createFakeVenue,
} from "@binference/chain/testing";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryRiskCacheStore } from "../fakes/memory-risk-cache-store.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  testChains,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import type { RiskCheck } from "../ports.js";
import { createRiskCheck } from "../risk/risk-check.js";
import { createTokenModelSimulator } from "../risk/test-round-trip.js";
import { createVenueHost } from "../venues/venue-host.js";

// Trades on a launch's own curve (decision 0212): a fake launchpad whose every launch has a curve
// of its own, which its curve read names and its trades call in place of its router.
const curve = "fake-curve";
const launchCurve = accountRefSchema.parse("fake:1:0x000000c1");
// A token the registry does not list, so the risk step runs its round trip on it.
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const deep: TokenRiskReport = { flags: [], liquidityUsdMicros: 50_000_000_000n };
// The coin at $600 and the registry's token at $1, as the policy and the gas reserve read them.
const prices = new Map([
  [testCoin, { numerator: 600n, denominator: 10n ** 12n }],
  [testToken, { numerator: 1n, denominator: 1n }],
]);

function venuesOf(): readonly Venue[] {
  return [createFakeVenue(), createFakeLaunchpad({ onCurve: [unlisted], launchCurve })];
}

// The engine's own risk step over the same venues, its round trip run by a model of the token
// that takes a 3% buy tax.
function riskOver(venues: readonly Venue[]) {
  const chains = testChains([curve]);
  const clock = createManualClock(testNowMs);
  const host = createVenueHost({ venues, chains, clock, callTimeoutMs: 5_000 });
  const source = createFakeRiskSource({ id: "first", reports: new Map([[unlisted, deep]]) });
  return createRiskCheck({
    sources: [{ source, isRequired: true }],
    cache: createMemoryRiskCacheStore(["first"]),
    cacheTtlMs: 600_000,
    sourceTimeoutMs: 5_000,
    host,
    simulator: createTokenModelSimulator({ buyTaxBps: 300 }),
    chains,
    clock,
    random: createSeededRandom(212),
  });
}

async function engineOver(options: TestEngineOptions = {}): Promise<TestEngine> {
  const venues = venuesOf();
  return startTestEngine({
    chains: testChains([curve]),
    venues,
    risk: riskOver(venues),
    prices,
    ...options,
    agent: { limits: { ...testLimits, venues: ["fake-swap", curve] }, ...options.agent },
  });
}

async function propose(
  test: TestEngine,
  request: IntentRequest,
  caller: EngineCaller = testCallers.cli,
): Promise<IntentView> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request, caller));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value;
}

const buy: Extract<IntentRequest, { kind: "buy" }> = {
  kind: "buy",
  agent: testAgent,
  wallet: testWallet,
  reason: "Buy the launch",
  token: unlisted,
  spend: { asset: testCoin, base: 1_000_000n },
};

describe("a trade on a launch's own curve", () => {
  it("measures the buy's round trip through the launch's curve, as the trade was built", async () => {
    const view = await propose(await engineOver(), buy);
    expect(view).toMatchObject({
      state: "awaiting_confirmation",
      quote: { place: { kind: "curve", launchpad: curve } },
      risk: { verdict: "warn", buyTaxBps: 300, sellTaxBps: 0 },
    });
  });
});

// A risk step that passes every token, so the auto test alone decides.
const passing: RiskCheck = {
  assess: async () =>
    await Promise.resolve({
      view: { verdict: "pass", flags: [], onCurve: false, checkedAt: testNowMs },
    }),
};

// An auto agent buys the token with the registry's token on a curve against it, from a clean turn
// under its caps: the plan approves the curve, a launch's own or the launchpad's router, then buys.
// The auto test passes it unless the spender is one no registry lists.
async function autoBuy(launch: { readonly launchCurve?: typeof launchCurve }) {
  const pad = createFakeLaunchpad({ onCurve: [unlisted], quoteAsset: testToken, ...launch });
  const test = await engineOver({
    venues: [createFakeVenue(), pad],
    risk: passing,
    paper: [
      { asset: testCoin, base: 10n ** 18n },
      { asset: testToken, base: 10n ** 18n },
    ],
    agent: { approvalMode: "auto" },
  });
  const spend = { asset: testToken, base: 1_000n };
  const view = await propose(test, { ...buy, spend }, testCallers.runtime);
  return view.state;
}

describe("the auto test of a trade on a launch's own curve", () => {
  it("asks for an approval of the launch's curve, which no registry lists", async () => {
    await expect(autoBuy({ launchCurve })).resolves.toBe("awaiting_confirmation");
  });

  it("fills an approval of the launchpad's registry contract with no card", async () => {
    await expect(autoBuy({})).resolves.toBe("paper_filled");
  });
});

// The agent's launch wallet beside its test wallet (decision 0217), held by custody on the chain;
// the agent is live, as only a live trade signs from the launch wallet.
const launchWallet = fixtureId("wal", 217);
const launchAccount = accountRefSchema.parse("fake:1:0x000000d9");

async function withLaunchWallet(options: TestEngineOptions = {}): Promise<TestEngine> {
  const test = await engineOver({
    risk: passing,
    ...options,
    agent: { mode: "live", limits: { ...testLimits, venues: ["fake-swap", curve] } },
    wallets: [testWallet, launchWallet],
    custodyWallets: new Map([[launchWallet, launchAccount]]),
  });
  test.stores.install.addWallet(
    testWalletRecord({
      id: launchWallet,
      agentId: testAgent,
      label: "curves",
      createdAtMs: testNowMs,
      role: "launch",
    }),
  );
  return test;
}

const { wallet: _named, ...unnamedBuy } = buy;
const swapOut: IntentRequest = {
  kind: "swap",
  agent: testAgent,
  reason: "Take the profit",
  from: unlisted,
  to: testCoin,
  amount: { base: 1n },
};

describe("a trade routed to the agent's launch wallet", () => {
  it("runs a live buy of a launch's token from the launch wallet, and names it on the card", async () => {
    const test = await withLaunchWallet();

    const view = await propose(test, unnamedBuy);

    expect(view.wallet).toBe(launchWallet);
    const card = await test.engine.handlers["intent/card"](testCall({ intent: view.intent }));
    expect(expectOk(card).lines[2]).toStrictEqual({
      key: "card.launchWallet",
      values: { wallet: { type: "text", text: "curves" } },
    });
  });

  it("runs any other trade from the default wallet, and a named wallet as named", async () => {
    const test = await withLaunchWallet();

    const registry = await propose(test, { ...unnamedBuy, token: testToken });
    const named = await propose(test, buy);
    const unheld = await propose(test, swapOut);

    expect([registry.wallet, named.wallet, unheld.wallet]).toStrictEqual([
      testWallet,
      testWallet,
      testWallet,
    ]);
  });

  it("sells a token the launch wallet holds from it, off the curve too", async () => {
    const held = new Map([[launchAccount, [{ asset: unlisted, base: 10n ** 18n }]]]);
    const test = await withLaunchWallet({ held });

    const sold = await propose(test, swapOut);

    expect(sold.wallet).toBe(launchWallet);
  });

  it("keeps a paper trade on the default wallet, which signs nothing", async () => {
    const test = await withLaunchWallet();
    await test.engine.handlers["agent/goPaper"](testCall({ agent: testAgent }));

    const view = await propose(test, unnamedBuy);

    expect(view.wallet).toBe(testWallet);
  });
});
