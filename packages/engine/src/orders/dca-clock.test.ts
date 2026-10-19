import type { DcaOrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { activeOrder, fillRowsOf, startFillEngine } from "./test-fills.js";
import { freeze, storedOrder, unfreeze } from "./test-orders.js";

const live = { signal: new AbortController().signal };

function dcaAt(cron: string, timezone: string): DcaOrderRequest {
  return {
    kind: "dca",
    agent: testAgent,
    token: testToken,
    side: "buy",
    size: { usdMicros: 10_000_000n },
    trigger: { cron, timezone },
    expiresAt: Date.parse("2027-12-31T00:00:00Z"),
  };
}

// Moves the test clock to `iso` and runs the schedule queue there.
async function runAt(test: TestEngine, iso: string): Promise<void> {
  await test.clock.advance(Date.parse(iso) - test.clock.now());
  await test.engine.runSchedules(live);
}

type Row = readonly [outcome: string, reason: string | undefined, at: string];

async function rowsOf(
  test: TestEngine,
  order: { readonly id: Parameters<typeof fillRowsOf>[1] },
): Promise<readonly Row[]> {
  const rows = await fillRowsOf(test, order.id);
  return rows.map(({ outcome, reason, atMs }): Row => [
    outcome,
    reason,
    new Date(atMs).toISOString(),
  ]);
}

describe("a DCA order on the wall clock of its zone", () => {
  it("buys a skipped wall time once, at the jump, the night the clocks go forward", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dcaAt("30 2 * * *", "America/New_York"));
    await runAt(test, "2027-03-13T08:00:00Z");
    // 02:30 does not exist on 14 March 2027 in New York: the period runs at 03:00 EDT, 07:00Z.
    await runAt(test, "2027-03-14T06:59:00Z");
    await runAt(test, "2027-03-14T07:00:10Z");
    await runAt(test, "2027-03-14T07:30:10Z");

    expect(await rowsOf(test, order)).toStrictEqual([
      ["filled", undefined, "2027-03-14T07:00:10.000Z"],
      ["skipped", "missed", "2027-03-13T08:00:00.000Z"],
    ]);
  });

  it("buys a repeated wall time once, at its first showing, the night the clocks go back", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dcaAt("30 1 * * *", "America/New_York"));
    await runAt(test, "2027-11-07T05:00:00Z");
    // 01:30 shows twice on 7 November 2027: at 05:30Z in EDT, then at 06:30Z in EST.
    await runAt(test, "2027-11-07T05:30:10Z");
    await runAt(test, "2027-11-07T06:30:10Z");

    expect(await rowsOf(test, order)).toStrictEqual([
      ["filled", undefined, "2027-11-07T05:30:10.000Z"],
      ["skipped", "missed", "2027-11-07T05:00:00.000Z"],
    ]);
  });
});

describe("a DCA order of a frozen agent", () => {
  it("buys none of the periods while paused, and records them as missed once unfrozen", async () => {
    const test = await startFillEngine();
    const order = await activeOrder(test, dcaAt("*/5 * * * *", "UTC"));
    await test.engine.runSchedules(live);
    await freeze(test);
    await test.clock.advance(12 * 60_000);
    await test.engine.runSchedules(live);
    await unfreeze(test);

    await test.engine.runSchedules(live);
    await test.clock.advance(3 * 60_000);
    await test.engine.runSchedules(live);

    expect((await storedOrder(test, order.id)).state).toBe("active");
    expect((await rowsOf(test, order)).map(([outcome, reason]) => [outcome, reason])).toStrictEqual(
      [
        ["filled", undefined],
        ["skipped", "missed"],
      ],
    );
  });
});
