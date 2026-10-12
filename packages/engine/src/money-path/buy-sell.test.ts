import { type Amount, assetRefSchema, type AssetRef, type Venue } from "@binference/chain";
import { createFakeLaunchpad, createFakeVenue } from "@binference/chain/testing";
import { type Bps, bpsSchema } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testLimits, testToken, testWallet } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testAccount,
  testCall,
  testCallers,
  testChains,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";

const curve = "fake-curve";
const otherCurve = "other-curve";
// A token the registry does not list, and so no buy's spend.
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
// The test token at $1 for each of its 6-decimal units: one base unit is one micro-dollar.
const prices = new Map([
  [testCoin, { numerator: 600n, denominator: 10n ** 12n }],
  [testToken, { numerator: 1n, denominator: 1n }],
]);

interface CountingVenue extends Venue {
  quotes(): number;
}

// A venue that counts the quotes the host asks of it.
function counting(venue: Venue): CountingVenue {
  let quotes = 0;
  return {
    ...venue,
    async quote(request, options) {
      quotes += 1;
      return venue.quote(request, options);
    },
    quotes: () => quotes,
  };
}

/** A buy of the test token with 0.000000000001 of the coin. */
function testBuy(changes: Partial<Extract<IntentRequest, { kind: "buy" }>> = {}): IntentRequest {
  return {
    kind: "buy",
    agent: testAgent,
    wallet: testWallet,
    reason: "Buy the launch",
    token: testToken,
    spend: { asset: testCoin, base: 1_000_000n },
    ...changes,
  };
}

/** A sale of 1,000 base units of the test token. */
function testSell(changes: Partial<Extract<IntentRequest, { kind: "sell" }>> = {}): IntentRequest {
  return {
    kind: "sell",
    agent: testAgent,
    wallet: testWallet,
    reason: "Take profit",
    token: testToken,
    amount: { base: 1_000n },
    ...changes,
  };
}

const share = (bps: number): { readonly percentBps: Bps } => ({ percentBps: bpsSchema.parse(bps) });

// An agent that may trade on the fake aggregator and the fake launchpad, with the test token
// priced and, on paper, 5,000 of its base units beside one coin.
async function engineWith(
  venues: readonly Venue[],
  options: TestEngineOptions & { readonly allowed?: readonly string[] } = {},
): Promise<TestEngine> {
  const { allowed = ["fake-swap", curve], agent, ...rest } = options;
  return startTestEngine({
    chains: testChains([curve, otherCurve]),
    venues,
    prices,
    paper: [
      { asset: testCoin, base: 10n ** 18n },
      { asset: testToken, base: 5_000n },
    ],
    ...rest,
    agent: { limits: { ...testLimits, venues: [...allowed] }, ...agent },
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

function ending(view: IntentView): readonly [string, string | undefined] {
  return [view.state, view.outcome?.reason];
}

const paperBalance = async (test: TestEngine, asset: AssetRef): Promise<bigint> => {
  const positions = await test.positions.positions(
    { walletId: testWallet, isPaper: true },
    { signal: new AbortController().signal },
  );
  return positions.find((position) => position.asset === asset)?.quantityBase ?? 0n;
};

describe("a buy's and a sell's place", () => {
  it("buys a token on the curve of the launchpad that holds it, and asks no aggregator", async () => {
    const aggregator = counting(createFakeVenue());
    const launchpad = createFakeLaunchpad({ onCurve: [testToken] });
    const view = await propose(await engineWith([aggregator, launchpad]), testBuy());
    expect(view).toMatchObject({
      kind: "buy",
      state: "awaiting_confirmation",
      quote: {
        route: [{ venue: curve, shareBps: 10_000 }],
        place: { kind: "curve", launchpad: curve },
        amountIn: { asset: testCoin, base: 1_000_000n },
        minOut: { asset: testToken },
      },
    });
    expect(aggregator.quotes()).toBe(0);
  });

  it("buys a graduated token in the pools through the aggregators", async () => {
    const graduated = createFakeLaunchpad({ onCurve: [testToken] });
    graduated.graduate(testToken);
    const pad = counting(graduated);
    const view = await propose(await engineWith([createFakeVenue(), pad]), testBuy());
    expect(view).toMatchObject({
      state: "awaiting_confirmation",
      quote: { route: [{ venue: "fake-swap" }], place: { kind: "pools" } },
    });
    expect(pad.quotes()).toBe(0);
  });

  it("buys a token no launchpad launched in the pools", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [unlisted] });
    const view = await propose(await engineWith([createFakeVenue(), launchpad]), testBuy());
    expect(view.quote).toMatchObject({ route: [{ venue: "fake-swap" }], place: { kind: "pools" } });
  });

  it("refuses a curve token whose launchpad the agent may not use, asking no venue", async () => {
    const aggregator = counting(createFakeVenue());
    const launchpad = counting(createFakeLaunchpad({ onCurve: [testToken] }));
    const test = await engineWith([aggregator, launchpad], { allowed: ["fake-swap"] });
    const view = await propose(test, testBuy());
    expect(ending(view)).toStrictEqual(["rejected_policy", "venue_off"]);
    expect([aggregator.quotes(), launchpad.quotes()]).toStrictEqual([0, 0]);
  });

  it("ends a token two launchpads claim as no route, asking neither", async () => {
    const first = counting(createFakeLaunchpad({ onCurve: [testToken] }));
    const second = counting(createFakeLaunchpad({ id: otherCurve, onCurve: [testToken] }));
    const test = await engineWith([createFakeVenue(), first, second], {
      allowed: ["fake-swap", curve, otherCurve],
    });
    expect(ending(await propose(test, testBuy()))).toStrictEqual(["failed_check", "no_route"]);
    expect([first.quotes(), second.quotes()]).toStrictEqual([0, 0]);
  });

  it("ends a buy as venue down when a launchpad cannot say what it holds", async () => {
    const down = {
      ...createFakeLaunchpad({ onCurve: [] }),
      curve: async () => await Promise.reject(new Error("rpc down")),
    };
    const view = await propose(await engineWith([createFakeVenue(), down]), testBuy());
    expect(ending(view)).toStrictEqual(["failed_check", "venue_down"]);
  });

  it("ends a curve trade that spends or receives what the curve does not take as no route", async () => {
    // The curve trades the test token against a token that is neither the coin nor listed.
    const launchpad = createFakeLaunchpad({ onCurve: [testToken], quoteAsset: unlisted });
    const test = await engineWith([createFakeVenue(), launchpad]);
    const buy = await propose(test, testBuy());
    const sale = await propose(test, testSell({ receive: testCoin }));
    expect([ending(buy), ending(sale)]).toStrictEqual([
      ["failed_check", "no_route"],
      ["failed_check", "no_route"],
    ]);
  });

  it("ends a buy in the pools as no route when the agent allows no aggregator", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [] });
    const test = await engineWith([createFakeVenue(), launchpad], { allowed: [curve] });
    expect(ending(await propose(test, testBuy()))).toStrictEqual(["failed_check", "no_route"]);
  });

  it("sells a curve token for the curve's quote asset, and a pool token for the coin", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [unlisted] });
    const test = await engineWith([createFakeVenue(), launchpad]);
    const onCurve = await propose(test, testSell({ token: unlisted }));
    const inPools = await propose(test, testSell());
    expect(onCurve.quote).toMatchObject({
      place: { kind: "curve", launchpad: curve },
      minOut: { asset: testCoin },
    });
    expect(inPools.quote).toMatchObject({ place: { kind: "pools" }, minOut: { asset: testCoin } });
  });

  it("refuses a buy that spends neither the chain's coin nor a registry token, storing nothing", async () => {
    const test = await engineWith([createFakeVenue()]);
    const spend: Amount = { asset: unlisted, base: 1n };
    const proposed = await test.engine.handlers["intent/propose"](testCall(testBuy({ spend })));
    expect(proposed).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });
});

describe("a sale by share", () => {
  it("sells that share of the paper position, rounded down", async () => {
    const test = await engineWith([createFakeVenue()]);
    // A third of 5,000 is 1,666.67: the sale sells 1,666.
    const view = await propose(test, testSell({ amount: share(3_333) }));
    expect(view.quote?.amountIn).toStrictEqual({ asset: testToken, base: 1_666n });
  });

  it("sells all of the paper position at 10000, and the fill empties it", async () => {
    const test = await engineWith([createFakeVenue()], { agent: { approvalMode: "auto" } });
    const view = await propose(test, testSell({ amount: share(10_000) }), testCallers.runtime);
    expect([view.state, view.quote?.amountIn.base]).toStrictEqual(["paper_filled", 5_000n]);
    expect(await paperBalance(test, testToken)).toBe(0n);
  });

  it("reads a live wallet's holding on chain", async () => {
    const held = new Map([[testAccount, [{ asset: testToken, base: 999n }]]]);
    const test = await engineWith([createFakeVenue()], { agent: { mode: "live" }, held });
    const view = await propose(test, testSell({ amount: share(3_333) }));
    // 999 × 0.3333 is 332.97: the sale sells 332.
    expect([view.state, view.quote?.amountIn.base]).toStrictEqual(["awaiting_confirmation", 332n]);
  });

  it("ends a share of nothing, or one that rounds to nothing, as nothing to sell", async () => {
    const test = await engineWith([createFakeVenue()], { agent: { mode: "live" } });
    const held = new Map([[testAccount, [{ asset: testToken, base: 1n }]]]);
    const dust = await engineWith([createFakeVenue()], { agent: { mode: "live" }, held });
    expect([
      ending(await propose(test, testSell({ amount: share(10_000) }))),
      ending(await propose(dust, testSell({ amount: share(9_999) }))),
    ]).toStrictEqual([
      ["failed_check", "nothing_to_sell"],
      ["failed_check", "nothing_to_sell"],
    ]);
  });

  it("ends a share of a token with no price that the wallet holds none of as nothing to sell", async () => {
    const test = await engineWith([createFakeVenue()], { agent: { mode: "live" } });
    const view = await propose(test, testSell({ token: unlisted, amount: share(5_000) }));
    expect(ending(view)).toStrictEqual(["failed_check", "nothing_to_sell"]);
  });

  it("swaps a share of a token as a sale by share does", async () => {
    const test = await engineWith([createFakeVenue()]);
    const swap: IntentRequest = {
      kind: "swap",
      agent: testAgent,
      wallet: testWallet,
      reason: "Rotate",
      from: testToken,
      to: testCoin,
      amount: share(5_000),
    };
    expect((await propose(test, swap)).quote?.amountIn.base).toBe(2_500n);
  });
});

// The owner's tap on a card's first version once its quote is older than the re-quote age.
async function tapLate(test: TestEngine, view: IntentView) {
  await test.clock.advance(11_000);
  const card = view.card?.card;
  if (card === undefined) {
    throw new Error("Expected a card.");
  }
  const args = { intent: view.intent, card, cardVersion: 1 };
  return test.engine.handlers["intent/confirm"](testCall(args));
}

describe("a re-quote of a buy or a sell at the tap", () => {
  it("never confirms a buy whose token graduated since its card, and leaves the card open", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [testToken] });
    const test = await engineWith([createFakeVenue(), launchpad]);
    const view = await propose(test, testBuy());
    launchpad.graduate(testToken);
    expect(await tapLate(test, view)).toStrictEqual({ ok: false, error: "quote.no_route" });
    const after = await test.engine.handlers["intent/get"](testCall({ intent: view.intent }));
    expect(after).toMatchObject({ ok: true, value: { state: "awaiting_confirmation" } });
  });

  it("sells its share of what the wallet holds at the re-quote, on a new card when worse", async () => {
    const held = new Map([[testAccount, [{ asset: testToken, base: 1_000n }]]]);
    const test = await engineWith([createFakeVenue()], { agent: { mode: "live" }, held });
    const view = await propose(test, testSell({ amount: share(5_000) }));
    held.set(testAccount, [{ asset: testToken, base: 600n }]);
    await tapLate(test, view);
    const after = await test.engine.handlers["intent/get"](testCall({ intent: view.intent }));
    expect(after).toMatchObject({
      ok: true,
      value: {
        state: "awaiting_confirmation",
        card: { version: 2 },
        quote: { amountIn: { asset: testToken, base: 300n } },
      },
    });
  });
});

// The header's action and the action line of a proposal's card.
async function cardActionOf(test: TestEngine, request: IntentRequest) {
  const view = await propose(test, request);
  const drawn = await test.engine.handlers["intent/card"](testCall({ intent: view.intent }));
  if (!drawn.ok) {
    throw new Error(`Expected a card, got ${drawn.error}.`);
  }
  const [header, action] = drawn.value.lines;
  return { header: header?.values["action"], action };
}

describe("a buy's and a sell's card", () => {
  it("names a curve buy's launchpad, and confirms a buy", async () => {
    const launchpad = createFakeLaunchpad({ onCurve: [testToken] });
    const test = await engineWith([createFakeVenue(), launchpad]);
    expect(await cardActionOf(test, testBuy())).toStrictEqual({
      header: { type: "choice", choice: "buy" },
      action: {
        key: "card.buy.action",
        values: {
          token: { type: "asset", asset: testToken },
          spend: { type: "amount", amount: { asset: testCoin, base: 1_000_000n } },
          place: {
            type: "line",
            line: { key: "card.place.curve", values: { launchpad: { type: "text", text: curve } } },
          },
        },
      },
    });
  });

  it("names the venue a sale in the pools runs on, and the share a sale by share sells", async () => {
    const test = await engineWith([createFakeVenue()]);
    const byAmount = await cardActionOf(test, testSell());
    const byShare = await cardActionOf(test, testSell({ amount: share(2_000) }));
    const all = await cardActionOf(test, testSell({ amount: share(10_000) }));
    expect(byAmount).toMatchObject({
      header: { type: "choice", choice: "sell" },
      action: { key: "card.sell.action", values: { place: { type: "text", text: "fake-swap" } } },
    });
    expect(byShare.action).toMatchObject({
      key: "card.sell.share",
      values: {
        share: { type: "percent", bps: 2_000 },
        token: { type: "asset", asset: testToken },
        amount: { type: "amount", amount: { asset: testToken, base: 1_000n } },
      },
    });
    expect(all.action).toMatchObject({
      key: "card.sell.all",
      values: { amount: { type: "amount", amount: { asset: testToken, base: 5_000n } } },
    });
  });
});
