import type { AccountRef, Amount, RelaySender } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import { restartBench } from "../executor/test-restart.js";
import { testToken } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import { fillRowsOf, wholeToken } from "./test-fills.js";
import { activeOrderOf, fillOnce, liveFillsOf, startLiveFills } from "./test-live-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

// One whole test token held by the test wallet, which a stop-loss sells.
function heldTokens(): ReadonlyMap<AccountRef, readonly Amount[]> {
  return new Map([[testAccount, [{ asset: testToken, base: wholeToken }]]]);
}

// Relays that hang after the fill's first send, the sale's approval, as an engine a crash stops
// there: the send reached the chain, and nothing after it runs until the restart.
function hangAfterFirstSend() {
  const state = { sends: 0 };
  const arrival = { arrive: (): void => undefined };
  const reached = new Promise<void>((resolve) => {
    arrival.arrive = resolve;
  });
  const sender = (relays: RelaySender): RelaySender => ({
    relays: relays.relays,
    async send(transaction, call) {
      const sent = await relays.send(transaction, call);
      state.sends += 1;
      if (state.sends > 1) {
        return sent;
      }
      arrival.arrive();
      await new Promise<void>((resolve) => {
        call.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return sent;
    },
  });
  return { sender, reached };
}

// A stop-loss sale stopped by a crash once its approval went out, with a block holding it.
async function saleStoppedAfterApproval(): Promise<{
  readonly bench: ExecutorBench;
  readonly order: Id<"ord">;
  readonly sale: Id<"int">;
}> {
  const hang = hangAfterFirstSend();
  const bench = await startLiveFills({ held: heldTokens(), sender: hang.sender });
  const order = await activeOrderOf(bench, testStopLoss());
  await fillOnce(bench, order.id);
  await hang.reached;
  bench.network.mine();
  const [sale] = await liveFillsOf(bench, "sell");
  return { bench, order: order.id, sale: sale?.id as Id<"int"> };
}

describe("a live sale a stop left after its approval", () => {
  it("goes on after the restart with its swap under its grant, and counts once", async () => {
    const { bench, order, sale } = await saleStoppedAfterApproval();

    const restarted = await restartBench(bench, { liveOrderFills: true });
    const state = await driveUntil(bench, sale, { states: ["reconciled", "failed_onchain"] });
    await flush();

    expect(state).toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.action.kind)).toStrictEqual(["call"]);
    expect(await storedOrder(bench.test, order)).toMatchObject({ state: "filled", fills: 1 });
    expect(await fillRowsOf(bench.test, order)).toMatchObject([{ outcome: "filled" }]);
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });

  it("resets its approval to zero after the restart once its grant ran out, and ends unsent", async () => {
    const { bench, order, sale } = await saleStoppedAfterApproval();
    await bench.test.clock.advance(61_000);

    const restarted = await restartBench(bench, { liveOrderFills: true });
    const state = await driveUntil(bench, sale, { states: ["reconciled", "failed_onchain"] });
    await flush();

    expect(state).toBe("failed_onchain");
    const actions = restarted.signed.map(({ step }) => step.action);
    expect(actions).toMatchObject([{ kind: "approve", amount: 0n }]);
    expect(await storedOrder(bench.test, order)).toMatchObject({ state: "active", fills: 0 });
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });
});
