import {
  type AccountRef,
  type Amount,
  checkFillGrant,
  type RelaySender,
  type SignRequest,
} from "@binference/chain";
import type { Id } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import {
  driveUntil,
  type ExecutorBench,
  flush,
  startExecutorBench,
} from "../executor/test-executor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import type { IntentChange } from "../intents/intent-change.js";
import type { IntentRecord } from "../intents/intent-record.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { moveOrder } from "./order-machine.js";
import { eightyCents, fillPrices, fillRowsOf, wholeToken } from "./test-fills.js";
import { createdOrder, storedOrder, tapCard, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

// A live limit buy of the test token with the coin, once, while the token is at or below $1.
const limitBuy: OrderRequest = {
  ...testStopLoss(),
  kind: "limit",
  side: "buy",
  spend: testCoin,
  size: { base: 10n ** 15n },
  trigger: { price: 1_000_000n, direction: "below" },
  maxFills: 1,
};

// A bench whose live engine fills live orders, its agent's wallet stored as setup stores it.
async function startLiveFills(
  options: {
    readonly intents?: (store: IntentStore) => IntentStore;
    readonly hold?: boolean;
    readonly held?: ReadonlyMap<AccountRef, readonly Amount[]>;
    readonly sender?: (sender: RelaySender) => RelaySender;
  } = {},
): Promise<ExecutorBench> {
  const { held, intents, ...rest } = options;
  const engine = {
    liveOrderFills: true,
    prices: fillPrices,
    ...(held === undefined ? {} : { held }),
    ...(intents === undefined ? {} : { intents }),
  };
  const bench = await startExecutorBench({ ...rest, engine });
  bench.test.stores.install.addWallet(
    testWalletRecord({ id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs }),
  );
  return bench;
}

async function activeOrderOf(bench: ExecutorBench, request: OrderRequest = limitBuy) {
  const created = await createdOrder(bench.test, request);
  await tapCard(bench.test, created.intent, "confirm");
  return storedOrder(bench.test, created.order);
}

async function fillOnce(bench: ExecutorBench, order: Id<"ord">) {
  const outcome = await bench.test.engine.fillOrder({ order, price: eightyCents }, live);
  await flush();
  return outcome;
}

// The buys the engine proposed for orders, live, in any state.
async function liveFillsOf(
  bench: ExecutorBench,
  kind: "buy" | "sell" = "buy",
): Promise<readonly IntentRecord[]> {
  const all = await bench.test.stores.intents.list(
    {
      states: [
        "confirmed",
        "executing",
        "included",
        "finalized",
        "reconciled",
        "expired",
        "cancelled",
        "failed_check",
        "failed_onchain",
      ],
      limit: 50,
    },
    live,
  );
  return all.filter(
    (record) => record.kind === kind && record.proposer === "engine" && !record.isPaper,
  );
}

// The notices the executor sent, oldest first.
function executorNotices(bench: ExecutorBench) {
  return bench.pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
}

// Each signing request's fill grant, held to the check the signer's rule 5 runs.
function grantChecksOf(signed: readonly SignRequest[], nowMs: number) {
  return signed.map((request) => {
    const { authorization } = request;
    if (authorization.kind !== "order") {
      return "no fill grant";
    }
    const check = {
      intent: request.intent,
      termsHash: request.termsHash,
      order: authorization.current,
      action: request.step.action,
      isCancel: request.step.replaces?.kind === "cancel",
      nowMs,
    };
    const checked = checkFillGrant(authorization.grant, check);
    return checked.ok ? "holds" : checked.error;
  });
}

describe("an auto order's live fill", () => {
  it("signs once under its order's grant, holds the line until it settles, then records the fill", async () => {
    const bench = await startLiveFills();
    const order = await activeOrderOf(bench);

    const first = await fillOnce(bench, order.id);
    const [intent] = await liveFillsOf(bench);
    const meanwhile = await fillOnce(bench, order.id);
    const before = await storedOrder(bench.test, order.id);
    const signedAtMs = bench.test.clock.now();

    expect([first, meanwhile]).toStrictEqual(["sent", "waiting"]);
    expect(before).toMatchObject({ state: "active", fills: 0 });
    expect(grantChecksOf(bench.signed, signedAtMs)).toStrictEqual(["holds"]);
    expect(bench.signed[0]?.authorization).toMatchObject({
      kind: "order",
      grant: { order: order.id, fillsBefore: 0, spend: { maxBase: 10n ** 15n } },
      current: { id: order.id, state: "active", fills: 0, maxFills: 1 },
    });

    const id = intent?.id as Id<"int">;
    await expect(driveUntil(bench, id, { states: ["reconciled"] })).resolves.toBe("reconciled");
    await flush();
    const after = await storedOrder(bench.test, order.id);
    const rows = await fillRowsOf(bench.test, order.id);
    const again = await fillOnce(bench, order.id);

    expect(after).toMatchObject({ state: "filled", fills: 1 });
    expect(rows).toMatchObject([{ outcome: "filled", intentId: id }]);
    expect(rows[0]?.announcedAtMs).toBeDefined();
    expect(again).toBe("inactive");
    expect(await liveFillsOf(bench)).toHaveLength(1);
    expect(bench.signed).toHaveLength(1);
    expect(executorNotices(bench)).toMatchObject([
      { key: "notice.fill", values: { mode: "live" }, parts: { result: { key: "fill.buy" } } },
    ]);
  });

  it("lapses in the queue past its grant, skipped as fill_lapsed, and its order fills again", async () => {
    const bench = await startLiveFills({ hold: true });
    const order = await activeOrderOf(bench, { ...limitBuy, maxFills: 2 });

    const first = await fillOnce(bench, order.id);
    await bench.test.clock.advance(60_000);
    await bench.release();
    await flush();
    const [lapsed] = await liveFillsOf(bench);
    const rows = await fillRowsOf(bench.test, order.id);

    expect(first).toBe("sent");
    expect(lapsed?.state).toBe("expired");
    expect(bench.signed).toStrictEqual([]);
    expect(rows).toMatchObject([{ outcome: "skipped", reason: "fill_lapsed" }]);
    expect(rows[0]?.notices).toBeUndefined();
    expect(await storedOrder(bench.test, order.id)).toMatchObject({ state: "active", fills: 0 });
    // A buy waits 15 seconds after a skip, then fills again.
    await expect(fillOnce(bench, order.id)).resolves.toBe("waiting");
    await bench.test.clock.advance(15_000);
    await expect(fillOnce(bench, order.id)).resolves.toBe("sent");
  });

  it("counts a fill that landed after a freeze paused its order, and after its order ended", async () => {
    const bench = await startLiveFills();
    const paused = await activeOrderOf(bench, { ...limitBuy, maxFills: 3 });
    await fillOnce(bench, paused.id);
    const [first] = await liveFillsOf(bench);
    const firstId = first?.id as Id<"int">;
    await driveUntil(bench, firstId, { states: ["included"] });
    await pauseOrder(bench, paused.id);
    await driveUntil(bench, firstId, { states: ["reconciled"] });

    expect(await storedOrder(bench.test, paused.id)).toMatchObject({ state: "paused", fills: 1 });
    expect(await fillRowsOf(bench.test, paused.id)).toMatchObject([{ outcome: "filled" }]);

    const cancelled = await activeOrderOf(bench, { ...limitBuy, maxFills: 3 });
    await fillOnce(bench, cancelled.id);
    const second = (await liveFillsOf(bench)).find(({ id }) => id !== firstId);
    const secondId = second?.id as Id<"int">;
    await driveUntil(bench, secondId, { states: ["included"] });
    expectOk(await bench.test.engine.handlers["order/cancel"](testCall({ order: cancelled.id })));
    await driveUntil(bench, secondId, { states: ["reconciled"] });

    expect(await storedOrder(bench.test, cancelled.id)).toMatchObject({
      state: "cancelled",
      fills: 1,
    });
    expect(await fillRowsOf(bench.test, cancelled.id)).toMatchObject([{ outcome: "filled" }]);
  });

  it("holds the line after a restart while the fill is unsettled, then fills nothing twice", async () => {
    const bench = await startLiveFills();
    const order = await activeOrderOf(bench);
    await fillOnce(bench, order.id);
    const restarted = bench.test.restart({ liveOrderFills: true });

    const outcome = await restarted.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("waiting");
    expect(await liveFillsOf(bench)).toHaveLength(1);
  });

  it("signs no later step once its order paused, and records the sale's end as a skip", async () => {
    const held = new Map<AccountRef, readonly Amount[]>([
      [testAccount, [{ asset: testToken, base: wholeToken }]],
    ]);
    // The owner's freeze pauses the order as the sale's first step, its approval, goes out.
    const pauser = pauserAtFirstSend();
    const bench = await startLiveFills({ held, sender: pauser.sender });
    const order = await activeOrderOf(bench, testStopLoss());
    pauser.arm(bench, order.id);

    await fillOnce(bench, order.id);
    const [sale] = await liveFillsOf(bench, "sell");
    const saleId = sale?.id as Id<"int">;

    await expect(driveUntil(bench, saleId, { states: ["failed_onchain"] })).resolves.toBe(
      "failed_onchain",
    );
    expect(bench.signed.map(({ step }) => step.action.kind)).toStrictEqual(["approve"]);
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "step_unsent", intentId: saleId },
    ]);
    expect(await storedOrder(bench.test, order.id)).toMatchObject({ state: "paused", fills: 0 });
  });

  it("is cancelled unsigned at the start when a stop left it before its confirmation", async () => {
    // The engine stops as the fill's quote is written: its intent stays `checked`.
    const stopper = stopperAtQuote();
    const bench = await startLiveFills({ intents: stopper.intents });
    const order = await activeOrderOf(bench);
    stopper.arm();
    const fill = bench.test.engine.fillOrder({ order: order.id, price: eightyCents }, stopper);
    await expect(fill).rejects.toThrow("This operation was aborted");
    const left = await bench.test.stores.intents.list({ states: ["checked"], limit: 10 }, live);

    const repaired = await bench.test.restart({ liveOrderFills: true }).repairOrderFills(live);

    expect(left).toHaveLength(1);
    expect(repaired).toBe(1);
    expect((await liveFillsOf(bench)).map(({ state }) => state)).toStrictEqual(["cancelled"]);
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "fill_failed", intentId: left[0]?.id },
    ]);
    expect(bench.signed).toStrictEqual([]);
  });
});

// Pauses the order, as a freeze of its agent does.
async function pauseOrder(bench: ExecutorBench, order: Id<"ord">): Promise<void> {
  const stored = await storedOrder(bench.test, order);
  const pause = moveOrder(stored, { type: "agent_frozen" }, bench.test.clock.now());
  await bench.test.stores.orders.move(pause.ok ? [pause.value] : [], live);
}

// Relays that pause the order once, right after the first send of its fill, once armed.
function pauserAtFirstSend() {
  const armed: { pause?: () => Promise<void> } = {};
  const sender = (relays: RelaySender): RelaySender => ({
    relays: relays.relays,
    async send(transaction, call) {
      const sent = await relays.send(transaction, call);
      const { pause } = armed;
      delete armed.pause;
      await pause?.();
      return sent;
    },
  });
  const arm = (bench: ExecutorBench, order: Id<"ord">): void => {
    armed.pause = async () => pauseOrder(bench, order);
  };
  return { sender, arm };
}

// An intent store that, once armed, stops the engine as a fill's quote is written: the stop's
// signal aborts and the write fails, so the fill's intent stays `checked`.
function stopperAtQuote() {
  const stopping = new AbortController();
  const armed = { isArmed: false };
  const intents = (store: IntentStore): IntentStore => ({
    ...store,
    transition: async (change: IntentChange, call) => {
      if (armed.isArmed && change.state === "quoted" && !stopping.signal.aborted) {
        stopping.abort();
        throw new Error("The engine stopped.");
      }
      return store.transition(change, call);
    },
  });
  const arm = (): void => {
    armed.isArmed = true;
  };
  return { intents, arm, signal: stopping.signal };
}
