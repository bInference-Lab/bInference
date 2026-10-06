import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createCallBudget } from "./call-budget.js";

describe("createCallBudget", () => {
  it("allows the burst at once, then the rate as time passes", async () => {
    const clock = createManualClock(0);
    const budget = createCallBudget({ clock, callsPerSecond: 20, callBurst: 3 });
    expect([budget.take(), budget.take(), budget.take(), budget.take()]).toStrictEqual([
      true,
      true,
      true,
      false,
    ]);
    await clock.advance(50);
    expect([budget.take(), budget.take()]).toStrictEqual([true, false]);
  });

  it("never holds more than its burst after a long wait", async () => {
    const clock = createManualClock(0);
    const budget = createCallBudget({ clock, callsPerSecond: 20, callBurst: 2 });
    await clock.advance(60_000);
    expect([budget.take(), budget.take(), budget.take()]).toStrictEqual([true, true, false]);
  });
});
