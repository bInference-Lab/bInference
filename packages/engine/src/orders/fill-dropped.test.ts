import { createIdSource, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testSnapshot } from "../approval/test-snapshot.js";
import { benchChain, driveUntil, type ExecutorBench, flush } from "../executor/test-executor.js";
import { restartBench } from "../executor/test-restart.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { testCoin, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { isOverCount, landedFillWrite } from "./fill-landed.js";
import { fillPrices, fillRowsOf } from "./test-fills.js";
import { activeOrderOf, fillOnce, liveFillsOf, startLiveFills } from "./test-live-fills.js";
import { storedOrder } from "./test-orders.js";

const live = { signal: new AbortController().signal };
// The stuck rules run at 3 and 6 blocks, and a step every relay refuses is dropped after 9.
const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };

function relaysAnswer(bench: ExecutorBench, kind: "refuse" | "accept"): void {
  const script =
    kind === "refuse" ? ({ kind, reason: "insufficient_funds" } as const) : ({ kind } as const);
  bench.network.script("relay-a", script);
  bench.network.script("relay-b", script);
}

// A live fill of a one-fill limit buy that every relay refused until the drop rule dropped it.
async function droppedFill(): Promise<{
  readonly bench: ExecutorBench;
  readonly order: Id<"ord">;
  readonly fill: Id<"int">;
}> {
  const bench = await startLiveFills({ limits });
  relaysAnswer(bench, "refuse");
  const order = await activeOrderOf(bench);
  await fillOnce(bench, order.id);
  const [fill] = await liveFillsOf(bench);
  const id = fill?.id as Id<"int">;
  await driveUntil(bench, id, { states: ["failed_onchain"] });
  return { bench, order: order.id, fill: id };
}

// The dropped fill's last transaction lands after all, as a relay that kept it sends it on.
async function landsLate(bench: ExecutorBench, fill: Id<"int">): Promise<void> {
  const sent = await bench.test.stores.transactions.ofIntent(fill, live);
  const last = sent.at(-1);
  relaysAnswer(bench, "accept");
  await bench.network.send({ chain: benchChain, raw: last?.raw ?? "" }, live);
}

describe("a live fill whose step was dropped", () => {
  it("holds the line while watched, then counts its late landing once, with its link", async () => {
    const { bench, order, fill } = await droppedFill();

    const meanwhile = await fillOnce(bench, order);
    await landsLate(bench, fill);
    await driveUntil(bench, fill, { states: [], blocks: 6 });
    await flush();
    const after = await fillOnce(bench, order);

    expect(meanwhile).toBe("waiting");
    expect(await storedOrder(bench.test, order)).toMatchObject({ state: "filled", fills: 1 });
    const rows = await fillRowsOf(bench.test, order);
    expect(rows.map(({ outcome, intentId }) => [outcome, intentId])).toStrictEqual([
      ["filled", fill],
      ["skipped", fill],
    ]);
    expect(after).toBe("inactive");
    expect(await liveFillsOf(bench)).toHaveLength(1);
  });

  it("resumes the watch after a restart and counts the late landing", async () => {
    const { bench, order, fill } = await droppedFill();
    const restarted = await restartBench(bench, { limits });

    await landsLate(bench, fill);
    await driveUntil(bench, fill, { states: [], blocks: 6 });
    await flush();

    expect(await storedOrder(bench.test, order)).toMatchObject({ state: "filled", fills: 1 });
    expect(restarted.signed).toStrictEqual([]);
    await restarted.executor.close({ signal: AbortSignal.abort() });
  });

  it("alarms the owner when a landed fill would pass its order's most fills, and still counts it", async () => {
    const bench = await startLiveFills({ hold: true });
    const order = await activeOrderOf(bench);
    await fillOnce(bench, order.id);
    const [fill] = await liveFillsOf(bench);
    const snapshot = await testSnapshot(bench.test, fill?.id as Id<"int">);
    const full = { ...order, state: "filled" as const, fills: 1 };
    const parts = {
      orders: bench.test.stores.orders,
      intents: bench.test.stores.intents,
      positions: bench.test.positions,
      prices: createFakePriceSource(fillPrices),
      chains: testChains(),
      ids: createIdSource({ clock: bench.test.clock, random: createSeededRandom(4) }),
    };
    const settled = {
      amountIn: { asset: testCoin, base: 1n },
      amountOut: { asset: testToken, base: 2n },
    };
    const call = { order: full, snapshot, settled, isBooked: true, atMs: 1, signal: live.signal };

    const write = await landedFillWrite(parts, call);

    expect(isOverCount(full)).toBe(true);
    expect(write?.moves).toMatchObject([{ state: "filled", fills: 2 }]);
    expect(write?.fill.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "notice.orderOverfilled",
          values: { fills: "2", maxFills: "1" },
        }),
      ]),
    );
  });
});
