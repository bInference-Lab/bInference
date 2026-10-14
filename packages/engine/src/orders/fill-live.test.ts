import {
  type AccountRef,
  type Amount,
  checkFillGrant,
  type RelaySender,
  type SignRequest,
} from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import type { IntentChange } from "../intents/intent-change.js";
import { expectOk, testAgent, testToken, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { moveOrder } from "./order-machine.js";
import { eightyCents, fillRowsOf, wholeToken } from "./test-fills.js";
import {
  activeOrderOf,
  executorNotices,
  fillOnce,
  limitBuy,
  liveFillsOf,
  startLiveFills,
} from "./test-live-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

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
      stepIndex: request.step.index,
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

  it("finishes a two-step sale whose order a freeze paused after its approval, and counts it", async () => {
    // The owner's freeze pauses the order as the sale's first step, its approval, goes out.
    const pauser = atFirstSend(pauseOrder);
    const bench = await startLiveFills({ held: heldTokens(), sender: pauser.sender });
    const order = await activeOrderOf(bench, testStopLoss());
    pauser.arm(bench, order.id);

    await fillOnce(bench, order.id);
    const [sale] = await liveFillsOf(bench, "sell");
    const saleId = sale?.id as Id<"int">;

    await expect(driveUntil(bench, saleId, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.action.kind)).toStrictEqual(["approve", "call"]);
    expect(await storedOrder(bench.test, order.id)).toMatchObject({ state: "filled", fills: 1 });
  });

  it("resets its approval to zero when its order ends after the approval, and ends unsent", async () => {
    // The owner cancels the order as the sale's first step, its approval, goes out.
    const canceller = atFirstSend(cancelOrder);
    const bench = await startLiveFills({ held: heldTokens(), sender: canceller.sender });
    const order = await activeOrderOf(bench, testStopLoss());
    canceller.arm(bench, order.id);

    await fillOnce(bench, order.id);
    const [sale] = await liveFillsOf(bench, "sell");
    const saleId = sale?.id as Id<"int">;

    await expect(driveUntil(bench, saleId, { states: ["failed_onchain"] })).resolves.toBe(
      "failed_onchain",
    );
    const actions = bench.signed.map(({ step }) => step.action);
    expect(actions).toMatchObject([{ kind: "approve" }, { kind: "approve", amount: 0n }]);
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "step_unsent", intentId: saleId },
    ]);
    expect(executorNotices(bench)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "notice.approvalReset" })]),
    );
    expect(await storedOrder(bench.test, order.id)).toMatchObject({ state: "cancelled", fills: 0 });
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

  it("holds the line while a dropped live fill is still watched, and frees it once the watch ends", async () => {
    const bench = await startLiveFills();
    const order = await activeOrderOf(bench);
    await droppedFill(bench, order.id);

    const watched = await fillOnce(bench, order.id);
    // The watch lasts 600 blocks of the chain's block time, 1 second on the test chain.
    await bench.test.clock.advance(600_001);
    const after = await fillOnce(bench, order.id);

    expect([watched, after]).toStrictEqual(["waiting", "sent"]);
  });

  it("never holds a paper order's fill behind the agent's live fill", async () => {
    const bench = await startLiveFills({ hold: true });
    const order = await activeOrderOf(bench);
    await fillOnce(bench, order.id);
    expectOk(await bench.test.engine.handlers["agent/goPaper"](testCall({ agent: testAgent })));
    const paper = await activeOrderOf(bench, { ...limitBuy, maxFills: 1 });

    const outcome = await fillOnce(bench, paper.id);

    expect(paper.isPaper).toBe(true);
    expect(outcome).toBe("filled");
  });
});

// A live fill of the order that ended `stuck_dropped` a moment ago: its dropped step is still watched.
async function droppedFill(bench: ExecutorBench, order: Id<"ord">): Promise<void> {
  const atMs = bench.test.clock.now();
  const id = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000dd");
  const draft = {
    id,
    agentId: testAgent,
    walletId: testWallet,
    kind: "buy",
    state: "failed_onchain",
    reason: "stuck_dropped",
    request: { kind: "buy" },
    authorizedBy: { order, fillsBefore: 0 },
    hasOutsideContent: false,
    isPaper: false,
    proposer: "engine",
    atMs,
    cause: { trigger: "step_dropped" },
    ledger: {
      id: idSchema("led").parse("led_0190f1c2-3a4b-7c5d-8e6f-0000000000dd"),
      atMs,
      kind: "failed_onchain",
      subject: id,
      agentId: testAgent,
      data: {},
    },
  } as const;
  expectOk(await bench.test.stores.intents.create(draft, live));
}

// Pauses the order, as a freeze of its agent does.
async function pauseOrder(bench: ExecutorBench, order: Id<"ord">): Promise<void> {
  const stored = await storedOrder(bench.test, order);
  const pause = moveOrder(stored, { type: "agent_frozen" }, bench.test.clock.now());
  await bench.test.stores.orders.move(pause.ok ? [pause.value] : [], live);
}

// One whole test token held by the test wallet, which a stop-loss sells.
function heldTokens(): ReadonlyMap<AccountRef, readonly Amount[]> {
  return new Map([[testAccount, [{ asset: testToken, base: wholeToken }]]]);
}

// Cancels the order, as the owner's `order/cancel` does.
async function cancelOrder(bench: ExecutorBench, order: Id<"ord">): Promise<void> {
  expectOk(await bench.test.engine.handlers["order/cancel"](testCall({ order })));
}

// Relays that act on the order once, right after the first send of its fill, once armed.
function atFirstSend(act: (bench: ExecutorBench, order: Id<"ord">) => Promise<void>) {
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
    armed.pause = async () => act(bench, order);
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
