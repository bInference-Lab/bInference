import { assetRefSchema } from "@binference/chain";
import { err, type Id, idSchema } from "@binference/core";
import type { IntentRequest, IntentView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import {
  testAgent,
  testCoin,
  testLimits,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";

const live = { signal: new AbortController().signal };
const otherWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000009");

async function propose(
  test: TestEngine,
  request = testSwap(),
  caller = testCallers.cli,
): Promise<IntentView> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request, caller));
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value;
}

async function statesOf(test: TestEngine, intent: Id<"int">): Promise<readonly string[]> {
  const events = await test.stores.intents.events(intent, live);
  return events.map((event) => event.toState);
}

async function ledgerKinds(test: TestEngine): Promise<readonly string[]> {
  const entries = await test.stores.ledger.list({ after: 0, limit: 100 }, live);
  return entries.map((entry) => entry.kind);
}

// The protocol error a proposal is refused with; an intent fails the test.
async function refusal(test: TestEngine, request: IntentRequest): Promise<string> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(request));
  if (proposed.ok) {
    throw new Error(`Expected a refusal, got an intent in ${proposed.value.state}.`);
  }
  return proposed.error;
}

// An intent store whose first move loses its race, as when a cancel lands first.
function losingFirstMove(store: IntentStore): IntentStore {
  let lost = false;
  return {
    ...store,
    async transition(change, options) {
      if (lost) {
        return store.transition(change, options);
      }
      lost = true;
      return await Promise.resolve(err("stale"));
    },
  };
}

describe("the money path", () => {
  it("runs a paper swap through every check and opens its first card in manual mode", async () => {
    const test = await startTestEngine();
    const view = await propose(test);
    expect(view).toMatchObject({
      agent: testAgent,
      wallet: testWallet,
      kind: "swap",
      state: "awaiting_confirmation",
      paper: true,
      outsideContent: false,
      quote: {
        route: [{ venue: "fake-swap", shareBps: 10_000 }],
        minOut: { asset: testToken, base: 1_990_000n },
        gas: { asset: testCoin, base: 0n },
      },
      simulation: { spent: [{ asset: testCoin, base: 1_000_000n }] },
      card: { version: 1, paper: true, outsideContent: false },
    });
    expect(await statesOf(test, view.intent)).toStrictEqual([
      "proposed",
      "checked",
      "quoted",
      "assessed",
      "simulated",
      "awaiting_confirmation",
    ]);
    expect(await ledgerKinds(test)).toStrictEqual(["proposed", "awaiting_confirmation"]);
  });

  it("fills a swap the auto mode authorizes on paper at once, with no card", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto" } });
    const view = await propose(test, testSwap(), testCallers.runtime);
    expect(view.state).toBe("paper_filled");
    expect(view.card).toBeUndefined();
    expect(view.outcome?.executions).toHaveLength(1);
    expect(await ledgerKinds(test)).toStrictEqual(["proposed", "confirmed", "paper_filled"]);
  });

  it("opens a card for an MCP client's proposal even in auto mode", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto" } });
    expect((await propose(test, testSwap(), testCallers.mcp)).state).toBe("awaiting_confirmation");
  });

  it("keeps a live agent's confirmed intent for the wallet queue instead of filling it", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto", mode: "live" } });
    const view = await propose(test, testSwap(), testCallers.runtime);
    expect([view.state, view.paper]).toStrictEqual(["confirmed", false]);
  });

  it("ends a swap over the per-trade cap in a policy refusal with its reason", async () => {
    const limits = { ...testLimits, perTradeUsdMicros: 0n };
    const view = await propose(await startTestEngine({ agent: { limits } }));
    expect([view.state, view.outcome]).toStrictEqual([
      "rejected_policy",
      { reason: "per_trade_cap" },
    ]);
  });

  it("refuses a paper swap that would spend the paper portfolio's gas reserve", async () => {
    const paper = [{ asset: testCoin, base: 10n ** 15n }];
    const view = await propose(await startTestEngine({ paper }));
    expect(view.outcome?.reason).toBe("gas_reserve");
  });

  it("refuses a live swap that would spend the wallet's gas reserve", async () => {
    const test = await startTestEngine({
      agent: { mode: "live" },
      facts: { nativeBalanceBase: 10n ** 15n },
    });
    expect((await propose(test)).outcome?.reason).toBe("gas_reserve");
  });

  it("fails the check when no venue can quote the swap", async () => {
    const view = await propose(await startTestEngine({ venues: [] }));
    expect([view.state, view.outcome?.reason]).toStrictEqual(["failed_check", "venue_down"]);
    expect(view.quote).toBeUndefined();
  });

  it("blocks a token the registry does not list, as no risk source can answer", async () => {
    const unknown = assetRefSchema.parse("fake:1/token:0x0000000f");
    const view = await propose(await startTestEngine(), testSwap({ to: unknown }));
    expect([view.state, view.outcome?.reason]).toStrictEqual(["risk_blocked", "sources_down"]);
    expect(Object.keys(view.assets)).toStrictEqual([testCoin]);
  });

  it("asks the policy about the slippage a request names on a pair of unlisted tokens", async () => {
    const unknown = assetRefSchema.parse("fake:1/token:0x0000000f");
    const request = testSwap({ to: unknown, maxSlippageBps: 400 as never });
    const view = await propose(await startTestEngine(), request);
    expect(view.outcome?.reason).toBe("slippage");
  });

  it("fails the check when the simulation reverts", async () => {
    const test = await startTestEngine({ refusal: "simulation_reverted" });
    const view = await propose(test);
    expect([view.state, view.outcome?.reason]).toStrictEqual([
      "failed_check",
      "simulation_reverted",
    ]);
  });

  it("stops where another write left the intent when a move loses its race", async () => {
    const test = await startTestEngine({ intents: losingFirstMove });
    const view = await propose(test);
    expect(view.state).toBe("proposed");
  });

  it("acts with the agent's default wallet when the request names none", async () => {
    const request = {
      kind: "swap" as const,
      agent: testAgent,
      reason: "Rotate into the token",
      from: testCoin,
      to: testToken,
      amount: { base: 1_000_000n },
    };
    const view = await propose(await startTestEngine(), request);
    expect(view.wallet).toBe(testWallet);
  });

  it("refuses what cannot become an intent and stores nothing", async () => {
    const test = await startTestEngine({ wallets: [testWallet, otherWallet] });
    const noVenue = await startTestEngine({ agent: { limits: { ...testLimits, venues: [] } } });
    const unknownChain = assetRefSchema.parse("fake:2/slip44:1");
    const send = {
      kind: "send" as const,
      agent: testAgent,
      reason: "Pay",
      amount: { asset: testCoin, base: 1n },
      to: { entry: "adr_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"adr"> },
    };
    const strangerAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
    const custodyless = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000008" as Id<"wal">;
    const answers = [
      await refusal(test, testSwap({ agent: strangerAgent })),
      await refusal(test, testSwap({ wallet: otherWallet })),
      await refusal(test, testSwap({ wallet: custodyless })),
      await refusal(test, send),
      await refusal(test, testSwap({ amount: { percentBps: 5_000 as never } })),
      await refusal(test, testSwap({ from: unknownChain })),
      await refusal(noVenue, testSwap()),
    ];
    expect(answers).toStrictEqual([
      "agent.not_found",
      "wallet.not_found",
      "wallet.not_found",
      "quote.no_route",
      "quote.no_route",
      "quote.no_route",
      "quote.no_route",
    ]);
    const stored = await test.stores.intents.list({ states: ["proposed"], limit: 10 }, live);
    expect(stored).toStrictEqual([]);
  });

  it("refuses a caller that is neither a client token nor a console device", async () => {
    const test = await startTestEngine();
    const stranger = { ...testCallers.cli, credential: "telegram" };
    await expect(
      test.engine.handlers["intent/propose"](testCall(testSwap(), stranger)),
    ).resolves.toStrictEqual(err("auth.scope"));
  });
});
