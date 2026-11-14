import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { expectOk, testCoin, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { copyTrade, testLeaderTx } from "./test-copies.js";
import { activeOrder, startFillEngine } from "./test-fills.js";
import { testCopy, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const minuteMs = 60_000;
const testDca: OrderRequest = {
  ...testStopLoss(),
  kind: "dca",
  side: "buy",
  size: { usdMicros: 1_000_000n },
  trigger: { cron: "0 9 * * *" },
};
const tokenFacts = { symbol: "TKN", name: "Test token", decimals: 6, verified: true };

// A leader's buy of the test token, stored as trade `id`, made at `atMs`.
function buyOf(id: number, atMs: number) {
  const paid = { asset: testCoin, base: 10n ** 17n };
  const buy = { id, txHash: testLeaderTx, side: "buy" as const, asset: testToken, atMs };
  return { ...buy, paid, facts: tokenFacts };
}

describe("an order's fills and skips on order/get", () => {
  it("answers the newest 50 rows of a DCA order, newest first, and says older ones exist", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testDca);
    const startMs = test.clock.now();
    for (const n of Array.from({ length: 60 }, (_, index) => index + 1)) {
      const row = {
        id: fixtureId("fil", n),
        orderId: order.id,
        outcome: "skipped" as const,
        reason: "missed" as const,
        atMs: startMs + n * minuteMs,
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
      await test.stores.orders.recordFill(row, live);
    }

    const got = expectOk(await test.engine.handlers["order/get"](testCall({ order: order.id })));

    expect(got.fillHistory).toHaveLength(50);
    expect(got.fillHistory?.[0]).toStrictEqual({
      fill: fixtureId("fil", 60),
      outcome: "skipped",
      reason: "missed",
      at: startMs + 60 * minuteMs,
    });
    expect(got.fillHistory?.at(-1)?.fill).toBe(fixtureId("fil", 11));
    expect(got.fillHistoryMore).toBe(true);
  });

  it("answers every row of an order with few, and no word of older ones", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, testDca);

    const got = expectOk(await test.engine.handlers["order/get"](testCall({ order: order.id })));

    expect(got.fillHistory).toStrictEqual([]);
    expect(got).not.toHaveProperty("fillHistoryMore");
  });

  it("carries a skip's reason, and the values its words take as the owner was told them", async () => {
    const test = await startFillEngine();
    const daily = { ...testCopy().trigger, dailyUsdMicros: 40_000_000n };
    const order = await activeOrder(test, testCopy({ trigger: daily }));
    await copyTrade(test, order.id, buyOf(1, test.clock.now()));
    await copyTrade(test, order.id, buyOf(2, test.clock.now()));
    await copyTrade(test, order.id, buyOf(3, test.clock.now()));
    await copyTrade(test, order.id, buyOf(4, test.clock.now() - minuteMs - 1));

    const got = expectOk(await test.engine.handlers["order/get"](testCall({ order: order.id })));

    expect(got.fillHistory?.[0]).toStrictEqual({
      fill: got.fillHistory?.[0]?.fill,
      outcome: "skipped",
      reason: "late",
      at: test.clock.now(),
    });
    expect(got.fillHistory?.slice(1)).toMatchObject([
      {
        outcome: "skipped",
        reason: "copy_daily_cap",
        reasonValues: { used: "$40.00", cap: "$40.00" },
      },
      { outcome: "filled" },
      { outcome: "filled" },
    ]);
    const filled = got.fillHistory?.slice(2);
    expect(filled?.filter(({ intent }) => intent === undefined)).toStrictEqual([]);
    expect(filled?.filter((row) => "reasonValues" in row)).toStrictEqual([]);
  });
});
