import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import {
  createReadBudget,
  createRefusalCounts,
  webhookReadsPerSecond,
  webhookRefusalRowsPerRate,
  webhookRefusalRulesKept,
} from "./intake-bounds.js";

describe("the webhook intake's bounds", () => {
  it("holds the reads of one second to the budget, and refills it as time passes", async () => {
    const clock = createManualClock(1_000);
    const reads = createReadBudget(clock);
    const taken = Array.from({ length: webhookReadsPerSecond + 5 }, () => reads.take());
    expect(taken.filter(Boolean)).toHaveLength(webhookReadsPerSecond);
    await clock.advance(1_000 / webhookReadsPerSecond);
    expect([reads.take(), reads.take()]).toStrictEqual([true, false]);
    await clock.advance(60_000);
    expect(Array.from({ length: 60 }, () => reads.take()).filter(Boolean)).toHaveLength(
      webhookReadsPerSecond,
    );
  });

  it("is full at ten times a rule's rate of refusals in its minute, and empty after it", async () => {
    const clock = createManualClock(1_000);
    const refusals = createRefusalCounts(clock);
    const full = 2 * webhookRefusalRowsPerRate;
    Array.from({ length: full - 1 }, () => refusals.count("whr_a"));
    expect(refusals.isFull("whr_a", 2)).toBe(false);
    refusals.count("whr_a");
    expect([refusals.isFull("whr_a", 2), refusals.isFull("whr_a", 3)]).toStrictEqual([true, false]);
    expect(refusals.isFull("whr_b", 1)).toBe(false);
    await clock.advance(60_000);
    expect(refusals.isFull("whr_a", 2)).toBe(false);
  });

  it("keeps a bounded number of rules, dropping the one counted longest ago", () => {
    const clock = createManualClock(1_000);
    const refusals = createRefusalCounts(clock);
    const fill = (rule: string): void => {
      Array.from({ length: webhookRefusalRowsPerRate }, () => refusals.count(rule));
    };
    fill("whr_first");
    Array.from({ length: webhookRefusalRulesKept - 1 }, (_, n) => `whr_${String(n)}`).forEach(fill);
    expect(refusals.isFull("whr_first", 1)).toBe(true);
    fill("whr_last");
    expect(refusals.isFull("whr_first", 1)).toBe(false);
    expect(refusals.isFull("whr_last", 1)).toBe(true);
  });
});
