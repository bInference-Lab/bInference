import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { OrderRecord } from "../orders/order-record.js";
import { activeOrderOf, fillOnce, liveFillsOf, startLiveFills } from "../orders/test-live-fills.js";
import { checkFillForQueue, type FillTermsParts, sourceNowFor } from "./fill-terms.js";
import type { ExecutorBench } from "./test-executor.js";

const live = { signal: new AbortController().signal };
const cap = 10n ** 15n;

/** A confirmed live fill of an order the owner confirmed, held before the executor takes it. */
interface HeldFill {
  readonly bench: ExecutorBench;
  readonly order: OrderRecord;
  readonly snapshot: IntentSnapshot;
}

async function heldFill(): Promise<HeldFill> {
  const bench = await startLiveFills({ hold: true });
  const order = await activeOrderOf(bench);
  await fillOnce(bench, order.id);
  const [fill] = await liveFillsOf(bench);
  const snapshot = await testSnapshot(bench.test, fill?.id ?? ("" as Id<"int">));
  return { bench, order, snapshot };
}

// What the queue's check reads, as the executor gives it, with the order store's read as given.
function partsOf(
  bench: ExecutorBench,
  read?: (order: OrderRecord | undefined) => OrderRecord | undefined,
): FillTermsParts {
  const { stores, engineOptions, clock } = bench.test;
  const orders = {
    get: async (id: Id<"ord">, call: { readonly signal: AbortSignal }) => {
      const stored = await stores.orders.get(id, call);
      return read === undefined ? stored : read(stored);
    },
  };
  return {
    chains: engineOptions.chains,
    orders,
    intents: stores.intents,
    rules: stores.webhookRules,
    agents: stores.agents,
    clock,
  };
}

// The order store's read of an order moved to the state given meanwhile.
function inState(state: OrderRecord["state"]) {
  return (order: OrderRecord | undefined): OrderRecord | undefined =>
    order === undefined ? order : { ...order, state };
}

const takes = { liveFills: true, isAgentLive: true, networkFeeCapNativeBase: cap, ...live };

describe("the queue's check of a confirmed live order fill", () => {
  it("signs a fill whose order still holds its grant, under that grant", async () => {
    const { bench, order, snapshot } = await heldFill();
    const checked = await checkFillForQueue(partsOf(bench), snapshot, takes);
    expect(checked.refusal).toBeUndefined();
    expect(checked.terms?.authorization).toMatchObject({
      kind: "fill",
      grant: { source: order.id, intent: snapshot.record.id, fillsBefore: 0 },
      current: { id: order.id, state: "active", fills: 0, maxFills: 1 },
    });
  });

  it("ends a fill whose agent is no longer live, paper_only", async () => {
    const { bench, snapshot } = await heldFill();
    const checked = await checkFillForQueue(partsOf(bench), snapshot, {
      ...takes,
      isAgentLive: false,
    });
    expect(checked).toStrictEqual({ refusal: "paper_only" });
  });

  it("ends a fill the policy refuses now, by the policy's reason", async () => {
    const { bench, snapshot } = await heldFill();
    const checked = await checkFillForQueue(partsOf(bench), snapshot, {
      ...takes,
      policyReason: "daily_cap",
    });
    expect(checked).toStrictEqual({ refusal: "daily_cap" });
  });

  it("lets a fill wait for its turn while the network's fee cap is unread", async () => {
    const { bench, snapshot } = await heldFill();
    const { networkFeeCapNativeBase: _cap, ...unread } = takes;
    await expect(checkFillForQueue(partsOf(bench), snapshot, unread)).resolves.toStrictEqual({});
  });

  it("ends a fill whose order is gone, fill_failed", async () => {
    const { bench, snapshot } = await heldFill();
    const parts = partsOf(bench, () => undefined);
    await expect(checkFillForQueue(parts, snapshot, takes)).resolves.toStrictEqual({
      refusal: "fill_failed",
    });
  });

  it("ends a fill whose order's card is gone, fill_failed", async () => {
    const { bench, snapshot } = await heldFill();
    const parts = { ...partsOf(bench), intents: { confirmation: async () => undefined } };
    await expect(checkFillForQueue(parts, snapshot, takes)).resolves.toStrictEqual({
      refusal: "fill_failed",
    });
  });

  it("ends a fill whose order a freeze paused, frozen", async () => {
    const { bench, snapshot } = await heldFill();
    const parts = partsOf(bench, inState("paused"));
    await expect(checkFillForQueue(parts, snapshot, takes)).resolves.toStrictEqual({
      refusal: "frozen",
    });
  });

  it("ends a fill whose order ended, order_inactive", async () => {
    const { bench, snapshot } = await heldFill();
    const parts = partsOf(bench, inState("cancelled"));
    await expect(checkFillForQueue(parts, snapshot, takes)).resolves.toStrictEqual({
      refusal: "order_inactive",
    });
  });

  it("lets a fill whose grant only ran out lapse as any authorization does", async () => {
    const { bench, snapshot } = await heldFill();
    await bench.test.clock.advance(10 * 60_000);
    await expect(checkFillForQueue(partsOf(bench), snapshot, takes)).resolves.toStrictEqual({});
  });

  it("grants nothing to a paper intent, fill_failed", async () => {
    const { bench, snapshot } = await heldFill();
    const paper = { ...snapshot, record: { ...snapshot.record, isPaper: true } };
    await expect(checkFillForQueue(partsOf(bench), paper, takes)).resolves.toStrictEqual({
      refusal: "fill_failed",
    });
  });

  it("grants nothing to an intent the owner confirmed on its own card, fill_failed", async () => {
    const { bench, snapshot } = await heldFill();
    const { authorizedBy: _fill, ...status } = snapshot.stored.status;
    const tapped = { ...snapshot, stored: { ...snapshot.stored, status } };
    await expect(checkFillForQueue(partsOf(bench), tapped, takes)).resolves.toStrictEqual({
      refusal: "fill_failed",
    });
  });
});

describe("the source of a live fill read again before a signature", () => {
  it("reads the order as it stands, with its card's terms hash", async () => {
    const { bench, order, snapshot } = await heldFill();
    const card = await bench.test.stores.intents.confirmation(order.intentId, live);
    await expect(sourceNowFor(partsOf(bench), snapshot.record, live.signal)).resolves.toEqual({
      id: order.id,
      state: "active",
      termsHash: card?.termsHash,
      expiresAtMs: order.expiresAtMs,
      fills: 0,
      maxFills: 1,
    });
  });

  it("reads no source once the order is gone, or for an intent no source authorized", async () => {
    const { bench, snapshot } = await heldFill();
    const gone = partsOf(bench, () => undefined);
    await expect(sourceNowFor(gone, snapshot.record, live.signal)).resolves.toBeUndefined();
    await expect(sourceNowFor(partsOf(bench), {}, live.signal)).resolves.toBeUndefined();
  });

  it("reads no source once the order's card is gone", async () => {
    const { bench, snapshot } = await heldFill();
    const parts = { ...partsOf(bench), intents: { confirmation: async () => undefined } };
    await expect(sourceNowFor(parts, snapshot.record, live.signal)).resolves.toBeUndefined();
  });
});
