import { createIdSource, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testSnapshot } from "../approval/test-snapshot.js";
import { flush } from "../executor/test-executor.js";
import type { ExecutorBench } from "../executor/test-executor.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { expectOk } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { createFillEnd } from "./fill-ends.js";
import { fillRowsOf } from "./test-fills.js";
import {
  activeOrderOf,
  executorNotices,
  fillOnce,
  limitBuy,
  liveFillsOf,
  startLiveFills,
} from "./test-live-fills.js";
import { storedOrder } from "./test-orders.js";

const live = { signal: new AbortController().signal };

// Whether the record is an engine's buy, as an order's fill is.
function isFill(record: IntentRecord): boolean {
  return record.kind === "buy" && record.proposer === "engine";
}

const boundTermsSchema = z.looseObject({ termsHash: z.string() });

// The terms hash a record's authorization stored; none on any other authorization.
function storedTermsHash(record: IntentRecord | undefined): string | undefined {
  const bound = boundTermsSchema.safeParse(record?.authorizedBy);
  return bound.success ? bound.data.termsHash : undefined;
}

// An intent store through which the executor reads an engine's buy with a quote other than the
// one it was confirmed with.
function changedQuote(store: IntentStore): IntentStore {
  return {
    ...store,
    get: async (id, call) => {
      const record = await store.get(id, call);
      return record !== undefined && isFill(record)
        ? { ...record, quote: { ...(record.quote as object), priceImpactBps: 1 } }
        : record;
    },
  };
}

// The owner withdraws a confirmed fill before it is signed, as `intent/cancel` does, through a
// writer of intents that adds each fill's end to its move.
async function ownerCancels(bench: ExecutorBench, intent: Id<"int">): Promise<void> {
  const { test } = bench;
  const ids = createIdSource({ clock: test.clock, random: createSeededRandom(17) });
  const fillEnd = createFillEnd({ orders: test.stores.orders, ids });
  const stored = createStoredIntents({
    intents: test.stores.intents,
    agents: test.stores.agents,
    ids,
    publish: () => undefined,
    fillEnd,
  });
  const snapshot = await testSnapshot(test, intent);
  const machine = createIntentStateMachine({ clock: test.clock });
  const trigger = { type: "cancel_requested", cause: "request", hasSignedStep: false } as const;
  const step = expectOk(machine.apply(snapshot.stored.status, trigger));
  const move = { intent, version: snapshot.stored.version, step, by: "tok_owner" };
  expectOk(await stored.move(move, live));
}

describe("a confirmed live fill the queue refuses", () => {
  it("ends at once when its order was cancelled, says so, and frees the agent's line", async () => {
    const bench = await startLiveFills({ hold: true });
    const order = await activeOrderOf(bench);
    const other = await activeOrderOf(bench, { ...limitBuy, maxFills: 2 });
    await fillOnce(bench, order.id);
    expectOk(await bench.test.engine.handlers["order/cancel"](testCall({ order: order.id })));

    await bench.release();
    await flush();
    const [fill] = await liveFillsOf(bench);
    const next = await fillOnce(bench, other.id);

    expect(fill?.state).toBe("cancelled");
    expect(bench.signed).toStrictEqual([]);
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "order_inactive", intentId: fill?.id as Id<"int"> },
    ]);
    expect(executorNotices(bench)).toMatchObject([
      { key: "notice.skipped", parts: { reason: { key: "reason.order_inactive" } } },
    ]);
    expect(next).toBe("sent");
  });

  it("ends at once while the executor's live fills are off, and signs nothing", async () => {
    const bench = await startLiveFills({ executorFills: false });
    const order = await activeOrderOf(bench);

    await fillOnce(bench, order.id);
    const [fill] = await liveFillsOf(bench);

    expect(fill?.state).toBe("cancelled");
    expect(bench.signed).toStrictEqual([]);
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "live_fills_off" },
    ]);
  });

  it("ends at once when its stored terms no longer hash to what its confirmation bound", async () => {
    const bench = await startLiveFills({ hold: true, executorIntents: changedQuote });
    const order = await activeOrderOf(bench);
    await fillOnce(bench, order.id);
    const [confirmed] = await liveFillsOf(bench);

    await bench.release();
    await flush();
    const [fill] = await liveFillsOf(bench);

    expect(storedTermsHash(confirmed)).toMatch(/^[0-9a-f]{64}$/u);
    expect(fill?.state).toBe("cancelled");
    expect(bench.signed).toStrictEqual([]);
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([{ reason: "fill_failed" }]);
  });

  it("ends its order when the owner withdraws it, so the order fires no fill again", async () => {
    const bench = await startLiveFills({ hold: true });
    const order = await activeOrderOf(bench, { ...limitBuy, maxFills: 3 });
    await fillOnce(bench, order.id);
    const [confirmed] = await liveFillsOf(bench);

    await ownerCancels(bench, confirmed?.id as Id<"int">);
    await bench.release();
    await flush();
    const again = await fillOnce(bench, order.id);

    expect(again).toBe("inactive");
    expect(await liveFillsOf(bench)).toHaveLength(1);
    expect(bench.signed).toStrictEqual([]);
    expect((await storedOrder(bench.test, order.id)).state).toBe("cancelled");
    expect(await fillRowsOf(bench.test, order.id)).toMatchObject([
      { outcome: "skipped", reason: "owner_cancelled", intentId: confirmed?.id as Id<"int"> },
    ]);
  });
});
