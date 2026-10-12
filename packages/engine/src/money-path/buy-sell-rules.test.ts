import { createFakeLaunchpad, createFakeVenue } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import type { IntentRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import {
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  testCall,
  testCallers,
  testChains,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import type { RiskCheck } from "../ports.js";

// Spec 6: a buy and a sell pass the same policy, risk, simulation, cap and outside-content rules
// as a swap that moves the same assets. Each case runs the swap and its buy or sell on engines set
// up alike, and expects both to end the same way.

const curve = "fake-curve";
const { turn: _clean, ...signedInRuntime } = testCallers.runtime;
const marked: EngineCaller = { ...signedInRuntime, turn: { hasOutsideContent: true } };

/** A buy and the swap that spends the same coin on the same token. */
const buying = {
  swap: testSwap(),
  trade: {
    kind: "buy",
    agent: testAgent,
    wallet: testWallet,
    reason: "Buy the token",
    token: testToken,
    spend: { asset: testCoin, base: 1_000_000n },
  },
} as const satisfies Record<string, IntentRequest>;

/** A sale and the swap that sells the same token for the coin: 0.2 coins, $120, at its quote. */
const selling = {
  swap: testSwap({ from: testToken, to: testCoin, amount: { base: 10n ** 17n } }),
  trade: {
    kind: "sell",
    agent: testAgent,
    wallet: testWallet,
    reason: "Take profit",
    token: testToken,
    amount: { base: 10n ** 17n },
    receive: testCoin,
  },
} as const satisfies Record<string, IntentRequest>;

// A risk step that blocks every token as a honeypot.
const honeypot: RiskCheck = {
  assess: async () =>
    await Promise.resolve({
      view: { verdict: "block", flags: [], onCurve: false, checkedAt: testNowMs },
      refusal: "honeypot",
    }),
};

interface Case {
  readonly name: string;
  readonly options?: TestEngineOptions;
  readonly caller?: EngineCaller;
  /** The slippage the request asks for; the agent's maximum when absent. */
  readonly slippageBps?: number;
  /** The state, the reason and the outside-content mark both intents end with. */
  readonly ends: readonly [string, string | undefined, boolean];
}

const auto = { approvalMode: "auto" } as const;
const atCap = [{ atMs: testNowMs - 1_000, valueUsdMicros: testLimits.rollingDayUsdMicros }];

const cases: readonly Case[] = [
  {
    name: "a trade over the per-trade cap",
    options: { agent: { limits: { ...testLimits, perTradeUsdMicros: 0n } } },
    ends: ["rejected_policy", "per_trade_cap", false],
  },
  {
    name: "a live trade past the rolling 24-hour cap",
    options: { agent: { mode: "live" }, facts: { recentOutflows: atCap } },
    ends: ["rejected_policy", "daily_cap", false],
  },
  {
    name: "a trade that asks for more slippage than the agent allows",
    slippageBps: 900,
    ends: ["rejected_policy", "slippage", false],
  },
  {
    name: "a trade whose token the risk step blocks",
    options: { risk: honeypot },
    ends: ["risk_blocked", "honeypot", false],
  },
  {
    name: "a trade whose simulation reverts",
    options: { refusal: "simulation_reverted" },
    ends: ["failed_check", "simulation_reverted", false],
  },
  {
    name: "an auto trade from a turn that read outside content",
    options: { agent: auto },
    caller: marked,
    ends: ["awaiting_confirmation", undefined, true],
  },
  {
    name: "an auto trade proposed by an MCP client",
    options: { agent: auto },
    caller: testCallers.mcp,
    ends: ["awaiting_confirmation", undefined, false],
  },
  {
    name: "an auto trade from a clean turn",
    options: { agent: auto },
    caller: testCallers.runtime,
    ends: ["paper_filled", undefined, false],
  },
  {
    name: "a trade in manual mode",
    ends: ["awaiting_confirmation", undefined, false],
  },
];

const optionsOf = (item: Case): TestEngineOptions => item.options ?? {};
const callerOf = (item: Case): EngineCaller => item.caller ?? testCallers.cli;

function asked<T extends IntentRequest>(item: Case, request: T): T {
  return item.slippageBps === undefined
    ? request
    : { ...request, maxSlippageBps: bpsSchema.parse(item.slippageBps) };
}

async function endOf(
  request: IntentRequest,
  options: TestEngineOptions,
  caller: EngineCaller,
): Promise<Case["ends"]> {
  const test = await startTestEngine(options);
  const proposed = await test.engine.handlers["intent/propose"](testCall(request, caller));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  const view = proposed.value;
  return [view.state, view.outcome?.reason, view.outsideContent];
}

describe.each([
  ["buy", buying],
  ["sell", selling],
] as const)("a %s in the pools", (_kind, pair) => {
  it.each(cases)("ends as the swap it matches: $name", async (item) => {
    const options = optionsOf(item);
    const caller = callerOf(item);
    const swap = await endOf(asked(item, pair.swap), options, caller);
    const trade = await endOf(asked(item, pair.trade), options, caller);
    expect([swap, trade]).toStrictEqual([item.ends, item.ends]);
  });

  it("ends as the swap it matches when its quote moves the price above the maximum", async () => {
    const steep = { venues: [createFakeVenue({ priceImpactBps: bpsSchema.parse(10_000) })] };
    const swap = await endOf(pair.swap, steep, testCallers.cli);
    const trade = await endOf(pair.trade, steep, testCallers.cli);
    expect([swap, trade]).toStrictEqual([
      ["failed_check", "price_impact", false],
      ["failed_check", "price_impact", false],
    ]);
  });
});

// On a curve, the launchpad's quote runs through the same steps, the coin being its quote asset.
function onCurve(options: TestEngineOptions = {}): TestEngineOptions {
  const limits = { ...testLimits, ...options.agent?.limits, venues: ["fake-swap", curve] };
  return {
    chains: testChains([curve]),
    venues: [createFakeVenue(), createFakeLaunchpad({ onCurve: [testToken] })],
    ...options,
    agent: { ...options.agent, limits },
  };
}

describe.each([
  ["buy", buying.trade],
  ["sell", selling.trade],
] as const)("a %s on a launchpad's curve", (_kind, trade) => {
  it.each(cases)("ends as a swap does: $name", async (item) => {
    const ends = await endOf(asked(item, trade), onCurve(optionsOf(item)), callerOf(item));
    expect(ends).toStrictEqual(item.ends);
  });
});
