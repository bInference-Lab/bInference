import type { DcaOrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inOrder } from "../contracts/store-fixtures.js";
import { testAgent, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import type { OrderFillRecord } from "./order-fill.js";
import { activeOrder, fillRowsOf, startFillEngine } from "./test-fills.js";
import { freeze, unfreeze } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const periodMs = 5 * 60_000;
const graceMs = 60_000;
const count = 3;

const dca: DcaOrderRequest = {
  kind: "dca",
  agent: testAgent,
  token: testToken,
  side: "buy",
  size: { usdMicros: 1_000_000n },
  trigger: { cron: "*/5 * * * *", timezone: "UTC", count },
};

/** What happens between two looks at the order: time, a queue run, a restart, a freeze. */
type Step =
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "run" }
  | { readonly kind: "restart" }
  | { readonly kind: "freeze" }
  | { readonly kind: "unfreeze" };

const steps: fc.Arbitrary<Step> = fc.oneof(
  // Whole periods land on their marks; seconds move within a minute or past it.
  {
    arbitrary: fc
      .integer({ min: 1, max: 4 })
      .map((n) => ({ kind: "wait" as const, ms: n * periodMs })),
    weight: 4,
  },
  {
    arbitrary: fc.integer({ min: 1_000, max: 90_000 }).map((ms) => ({ kind: "wait" as const, ms })),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: "run" as const }), weight: 5 },
  { arbitrary: fc.constant({ kind: "restart" as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: "freeze" as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: "unfreeze" as const }), weight: 1 },
);

/** Drives one test's engine through steps; a restart swaps in a new one on the same stores. */
function driverOf(test: TestEngine): (step: Step) => Promise<void> {
  let engine = test.engine;
  let isFrozen = false;
  return async (step) => {
    const now = { ...test, engine };
    if (step.kind === "wait") {
      await test.clock.advance(step.ms);
    } else if (step.kind === "run") {
      await engine.runSchedules(live);
    } else if (step.kind === "restart") {
      engine = test.restart();
      await engine.repairOrderFills(live);
    } else if (step.kind === "freeze" && !isFrozen) {
      await freeze(now);
      isFrozen = true;
    } else if (step.kind === "unfreeze" && isFrozen) {
      await unfreeze(now);
      isFrozen = false;
    }
  };
}

/** Each buy's period: the five-minute mark it came in. */
const periodOf = (row: OrderFillRecord): number => row.atMs - (row.atMs % periodMs);

describe("a DCA order, for every history of waits, runs, restarts, freezes and unfreezes", () => {
  it("buys at most once a period, only within its minute, and never past its count", async () => {
    const histories = fc.array(steps, { minLength: 4, maxLength: 30 });
    const seen = { buys: 0, skips: 0 };
    await fc.assert(
      fc.asyncProperty(histories, async (history: readonly Step[]) => {
        const test = await startFillEngine();
        const order = await activeOrder(test, dca);
        const take = driverOf(test);
        await inOrder(history, take);
        const rows = await fillRowsOf(test, order.id);
        const buys = rows.filter(({ outcome }) => outcome === "filled");
        seen.buys += buys.length;
        seen.skips += rows.length - buys.length;

        expect(buys.length).toBeLessThanOrEqual(count);
        expect(new Set(buys.map(periodOf)).size).toBe(buys.length);
        expect(buys.filter((row) => row.atMs - periodOf(row) > graceMs)).toStrictEqual([]);
      }),
      { numRuns: 60 },
    );
    // The histories bought and skipped, so the property held over buys, not over nothing.
    expect([seen.buys > 0, seen.skips > 0]).toStrictEqual([true, true]);
  });
});
