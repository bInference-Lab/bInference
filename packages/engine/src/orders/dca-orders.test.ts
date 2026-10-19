import type { DcaOrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { activeOrder, fillIntentsOf, fillRowsOf, startFillEngine } from "./test-fills.js";
import { storedOrder } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const minuteMs = 60_000;
// The test clock starts at 08:00 UTC; the order buys at 08:05, 08:10 and 08:15.
const firstAt = testNowMs + 5 * minuteMs;

const dca: DcaOrderRequest = {
  kind: "dca",
  agent: testAgent,
  token: testToken,
  side: "buy",
  size: { usdMicros: 10_000_000n },
  trigger: { cron: "*/5 * * * *", count: 3 },
  reason: "Buy a little every five minutes",
};

function outcomes(rows: Awaited<ReturnType<typeof fillRowsOf>>) {
  return rows.map(({ outcome, reason }) =>
    reason === undefined ? outcome : `${outcome}:${reason}`,
  );
}

describe("a DCA order", () => {
  it("buys once per period on the owner's clock, and fills after its count", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    await test.engine.runSchedules(live);
    expect((await storedOrder(test, order.id)).triggerState).toStrictEqual({ nextAtMs: firstAt });

    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);
    await test.engine.runSchedules(live);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled"]);

    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);
    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);

    const done = await storedOrder(test, order.id);
    expect([done.state, done.fills]).toStrictEqual(["filled", 3]);
    const buys = await fillIntentsOf(test);
    expect(buys.map(({ kind, state }) => [kind, state])).toStrictEqual([
      ["buy", "paper_filled"],
      ["buy", "paper_filled"],
      ["buy", "paper_filled"],
    ]);
  });

  it("skips the periods missed while the engine was off, records them, and never buys them later", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    await test.engine.runSchedules(live);

    // Off from 08:00 to 08:22: the buys of 08:05, 08:10, 08:15 and 08:20 were due meanwhile.
    await test.clock.advance(22 * minuteMs);
    await test.engine.runSchedules(live);
    const after = await storedOrder(test, order.id);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["skipped:missed"]);
    expect([after.fills, after.triggerState]).toStrictEqual([
      0,
      { nextAtMs: firstAt + 20 * minuteMs },
    ]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);

    await test.clock.advance(3 * minuteMs);
    await test.engine.runSchedules(live);
    expect(outcomes(await fillRowsOf(test, order.id))).toStrictEqual(["filled", "skipped:missed"]);
  });

  it("buys nothing while its agent is frozen", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dca);
    await test.engine.runSchedules(live);
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));

    await test.clock.advance(5 * minuteMs);
    await test.engine.runSchedules(live);

    expect((await storedOrder(test, order.id)).state).toBe("paused");
    expect(await fillRowsOf(test, order.id)).toStrictEqual([]);
  });
});
