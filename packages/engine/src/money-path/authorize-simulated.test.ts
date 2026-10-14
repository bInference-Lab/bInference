import { ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import { flush, startExecutorBench } from "../executor/test-executor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import type { Authorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import { eightyCents, fillPrices } from "../orders/test-fills.js";
import { createdOrder, tapCard, testStopLoss } from "../orders/test-orders.js";
import { authorizeSimulated, type AuthorizeParts } from "./authorize-simulated.js";

const live = { signal: new AbortController().signal };

const openGate: CapGate = {
  serially: async (_agent, confirm) => confirm(),
  spent: async () => Promise.resolve(0n),
  fits: async () => Promise.resolve(true),
};

// A live order's fill as it reached `simulated`: one the engine confirmed, read back one step.
async function simulatedLiveFill(): Promise<IntentSnapshot> {
  const bench = await startExecutorBench({
    hold: true,
    engine: { liveOrderFills: true, prices: fillPrices },
  });
  bench.test.stores.install.addWallet(
    testWalletRecord({ id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs }),
  );
  const created = await createdOrder(bench.test, {
    ...testStopLoss(),
    kind: "limit",
    side: "buy",
    size: { base: 10n ** 15n },
    trigger: { price: 1_000_000n, direction: "below" },
  });
  await tapCard(bench.test, created.intent, "confirm");
  await bench.test.engine.fillOrder({ order: created.order, price: eightyCents }, live);
  await flush();
  const [fill] = await bench.test.stores.intents.list({ states: ["confirmed"], limit: 5 }, live);
  const confirmed = await testSnapshot(bench.test, fill?.id ?? created.intent);
  const status = { ...confirmed.stored.status, state: "simulated" as const };
  return { ...confirmed, stored: { ...confirmed.stored, status } };
}

// Authorizes the fill with live fills on or off, and answers the moves it stored, and whether its
// check in the agent's line ran.
async function authorized(simulated: IntentSnapshot, switches: { readonly liveFills: boolean }) {
  const { liveFills } = switches;
  const moves: IntentMove[] = [];
  const checks: true[] = [];
  const parts = {
    stored: {
      move: async (move: IntentMove) => {
        moves.push(move);
        return Promise.resolve(ok(simulated));
      },
    },
    machine: createIntentStateMachine({ clock: createManualClock(testNowMs) }),
    signal: live.signal,
    gate: openGate,
    isLocked: () => false,
    wallet: {} as never,
    liveFills,
    fill: {
      authorization: { order: simulated.stored.status.authorizedBy as never },
      isPaper: simulated.record.isPaper,
      decimals: 6,
      check: async () =>
        Promise.resolve(async () => {
          checks.push(true);
          return Promise.resolve(undefined);
        }),
      termsHash: async () => Promise.resolve(fillTerms),
    },
  } as unknown as AuthorizeParts;
  await authorizeSimulated(parts, simulated, {} as never);
  return {
    states: moves.map(({ step }) => [step.status.state, step.status.reason]),
    checks,
    bound: moves.map(({ step }) => termsHashOf(step.status.authorizedBy)),
  };
}

const fillTerms = "f".repeat(64);

// The fill terms hash an authorization stored; none on any other authorization.
function termsHashOf(authorization: Authorization | undefined): string | undefined {
  return authorization !== undefined && "termsHash" in authorization
    ? authorization.termsHash
    : undefined;
}

describe("the authorization of an auto order's fill", () => {
  it("ends a live fill failed_check, live_fills_off, while live fills are off", async () => {
    const simulated = await simulatedLiveFill();

    const off = await authorized(simulated, { liveFills: false });
    const on = await authorized(simulated, { liveFills: true });

    expect(off).toStrictEqual({
      states: [["failed_check", "live_fills_off"]],
      checks: [],
      bound: [termsHashOf(simulated.stored.status.authorizedBy)],
    });
    expect(on).toStrictEqual({
      states: [["confirmed", undefined]],
      checks: [true],
      bound: [fillTerms],
    });
  });

  it("confirms a paper fill whether live fills are on or off", async () => {
    const simulated = await simulatedLiveFill();
    const paper = {
      ...simulated,
      record: { ...simulated.record, isPaper: true },
      stored: { ...simulated.stored, status: { ...simulated.stored.status, isPaper: true } },
    };

    await expect(authorized(paper, { liveFills: false })).resolves.toMatchObject({
      states: [["confirmed", undefined]],
    });
  });
});
