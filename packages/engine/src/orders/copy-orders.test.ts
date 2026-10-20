import { assetRefParts, assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakeRiskCheck } from "../fakes/fake-risk-check.js";
import { expectOk, testLimits, testNowMs, testToken } from "../intents/test-intents.js";
import type { StoredActivity } from "../leaders/tracked-wallet-record.js";
import { testCall, testChains } from "../operations/test-engine.js";
import { copiedHeldOf, type CopyTaking } from "./copy-state.js";
import { copyStateNow, leaderTrade, storeTrades, takeTrade } from "./test-copies.js";
import {
  activeOrder,
  fillIntentsOf,
  fillPrices,
  fillRowsOf,
  noticesOf,
  startFillEngine,
} from "./test-fills.js";
import { testCopy, testLeader } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
// The fake venue pays two base units for one, so the token's price keeps a copy's sale small.
const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });

// The take of a stored buy of the test token, the moment it was made.
function takingOf(stored: StoredActivity | undefined): Omit<CopyTaking, "take"> {
  if (stored === undefined) {
    throw new Error("Expected the stored trade.");
  }
  const { id, atMs, txHash } = stored;
  return { id, txHash, side: "buy", asset: testToken, atMs };
}

function outcomes(rows: Awaited<ReturnType<typeof fillRowsOf>>) {
  return rows.map(({ outcome, reason }) =>
    reason === undefined ? outcome : `${outcome}:${reason}`,
  );
}

describe("the copy orders' runner", () => {
  it("copies each stored leader buy once, however often it runs", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);

    await test.engine.runCopies(live);
    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled"]);
    expect(await fillIntentsOf(test)).toHaveLength(1);
  });

  it("passes over trades from before the order and trades it does not follow", async () => {
    const test = await startFillEngine({ prices });
    const before = leaderTrade(1, { side: "buy", atMs: testNowMs - 1 });
    const order = await activeOrder(test, testCopy());
    const now = test.clock.now();
    const stored = await storeTrades(test, [
      before,
      leaderTrade(2, { side: "sell", atMs: now, shareSoldBps: bpsSchema.parse(5_000) }),
    ]);

    await test.engine.runCopies(live);

    expect(await fillRowsOf(test, order.id)).toStrictEqual([]);
    expect((await copyStateNow(test, order.id)).through).toBe(stored.at(-1)?.id);
  });

  it("sells 40% of the copied position when the leader sells 40%", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);
    const bought = copiedHeldOf(await copyStateNow(test, order.id), testToken);
    const share = bpsSchema.parse(4_000);
    await storeTrades(test, [
      leaderTrade(2, { side: "sell", atMs: test.clock.now(), shareSoldBps: share }),
    ]);

    await test.engine.runCopies(live);

    const sale = (await fillIntentsOf(test)).find(({ kind }) => kind === "sell");
    expect(sale?.request).toMatchObject({ amount: { base: String((bought * 4_000n) / 10_000n) } });
    expect(copiedHeldOf(await copyStateNow(test, order.id), testToken)).toBe(
      bought - (bought * 4_000n) / 10_000n,
    );
  });

  it("skips a leader's buy of a honeypot and tells the owner which token", async () => {
    const risk = createFakeRiskCheck({
      chains: testChains(),
      clock: createManualClock(testNowMs),
      refusal: "honeypot",
    });
    const test = await startFillEngine({ prices, risk });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [
      leaderTrade(1, { side: "buy", atMs: test.clock.now(), asset: unlisted }),
    ]);

    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:honeypot"]);
    const told = noticesOf(test).map((data) => JSON.stringify(data));
    expect(told.find((text) => text.includes('"reason.honeypot"'))).toContain(
      '"token":"UNL 0x0000000f"',
    );
  });

  it("never copies a buy read after an outage, and tells the owner it came late", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
    await test.clock.advance(61_000);

    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:late"]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);
  });

  it("copies a trade once across a restart, and records one a stop cut off as missed", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);

    const again = test.restart();
    await again.repairOrderFills(live);
    await again.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled"]);
    expect(await fillIntentsOf(test)).toHaveLength(1);
  });

  it("records a trade a stop cut off between its take and its fill as missed, never copied", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    const [stored] = await storeTrades(test, [
      leaderTrade(1, { side: "buy", atMs: test.clock.now() }),
    ]);
    await takeTrade(test, order.id, takingOf(stored));

    const again = test.restart();
    await again.repairOrderFills(live);
    await again.repairOrderFills(live);
    await again.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:missed"]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);
  });

  it("still sells the leader's share after an outage, telling the owner the sale was late", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);
    const share = bpsSchema.parse(4_000);
    const soldAtMs = test.clock.now();
    await storeTrades(test, [
      leaderTrade(2, { side: "sell", atMs: soldAtMs, shareSoldBps: share }),
    ]);
    await test.clock.advance(3_600_000);

    await test.engine.runCopies(live);
    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled", "filled"]);
    const told = noticesOf(test).map((data) => JSON.stringify(data));
    expect(told.find((text) => text.includes('"fill.copySellLate"'))).toContain(
      `"when":${String(soldAtMs)}`,
    );
  });

  it("sells, once and late, a leader sale a stop cut off between its take and its fill", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);
    const share = bpsSchema.parse(5_000);
    const [sale] = await storeTrades(test, [
      leaderTrade(2, { side: "sell", atMs: test.clock.now(), shareSoldBps: share }),
    ]);
    await test.clock.advance(1_000);
    const taking = { ...takingOf(sale), side: "sell" as const, shareSoldBps: share };
    await takeTrade(test, order.id, taking);
    await test.clock.advance(120_000);

    const again = test.restart();
    await again.repairOrderFills(live);
    await again.runCopies(live);
    await again.runCopies(live);

    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled", "filled"]);
    const sales = (await fillIntentsOf(test)).filter(({ kind }) => kind === "sell");
    expect(sales).toHaveLength(1);
  });

  it("tells five skips an hour, then one line for the rest once the hour ends", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    const atMs = test.clock.now();
    const buys = [1, 2, 3, 4, 5, 6, 7].map((n) => leaderTrade(n, { side: "buy", atMs }));
    await storeTrades(test, buys);
    await test.clock.advance(61_000);

    await test.engine.runCopies(live);
    await test.clock.advance(3_600_000);
    await test.engine.tickOrders(live);
    await test.engine.tickOrders(live);

    expect(await fillRowsOf(test, order.id)).toHaveLength(7);
    const told = noticesOf(test).map((data) => JSON.stringify(data));
    expect(told.filter((text) => text.includes('"reason.late"'))).toHaveLength(5);
    const held = told.filter((text) => text.includes('"notice.copyHeld"'));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain('"count":"2"');
  });

  it("never takes again a sale whose take ended in a row, however a restart finds it", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);
    await storeTrades(test, [leaderTrade(2, { side: "sell", atMs: test.clock.now() })]);
    await test.engine.runCopies(live);

    const again = test.restart();
    await again.repairOrderFills(live);
    await again.runCopies(live);

    const rows = await fillRowsOf(test, order.id);
    expect(outcomes(rows)).toStrictEqual(["skipped:share_unread", "filled"]);
    expect(rows.map(({ copy }) => copy?.take)).toStrictEqual([2, 1]);
  });

  it("copies a leader trade stored twice once, and only once its block is deep enough", async () => {
    const test = await startFillEngine({ prices });
    const order = await activeOrder(test, testCopy());
    const buy = leaderTrade(1, { side: "buy", atMs: test.clock.now() });
    const read = {
      chain: assetRefParts(testToken).chain,
      from: 1n,
      to: 2n,
      toHash: `0x${"2".padStart(64, "0")}`,
      atMs: test.clock.now(),
      wallets: [{ account: testLeader, sinceBlock: 1n, readFrom: 1n }],
      trades: [buy],
      overflows: [],
    };
    await test.stores.trackedWallets.record(read, live);

    await test.engine.runCopies(live);
    const shallow = await fillRowsOf(test, order.id);
    // A reorganization stored the same transaction again, at another log index.
    await storeTrades(test, [{ ...buy, block: 2n, logIndex: 3 }]);
    await test.engine.runCopies(live);

    expect(shallow).toStrictEqual([]);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled"]);
    expect(await fillIntentsOf(test)).toHaveLength(1);
  });

  it("counts the agent's day per leader over its ended copy orders too", async () => {
    const limits = { ...testLimits, copyPerLeaderDayUsdMicros: 40_000_000n };
    const test = await startFillEngine({ prices, agent: { limits } });
    const first = await activeOrder(test, testCopy());
    const buys = [1, 2].map((n) => leaderTrade(n, { side: "buy", atMs: test.clock.now() }));
    await storeTrades(test, buys);
    await test.engine.runCopies(live);
    expectOk(await test.engine.handlers["order/cancel"](testCall({ order: first.id })));
    await test.clock.advance(1_000);
    const second = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(3, { side: "buy", atMs: test.clock.now() })]);

    await test.engine.runCopies(live);

    expect(outcomes(await fillRowsOf(test, first.id))).toStrictEqual(["filled", "filled"]);
    const rows = await fillRowsOf(test, second.id);
    expect(outcomes(rows)).toStrictEqual(["skipped:copy_daily_cap"]);
  });
});
