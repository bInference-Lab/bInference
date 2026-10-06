import { describe, expect, it } from "vitest";
import { clockContract } from "../contracts/clock-contract.js";
import { createManualClock } from "./manual-clock.js";

describe("manual clock", () => {
  it.each(
    clockContract({
      create: () => {
        const clock = createManualClock(1_700_000_000_000);
        return { clock, advance: async (delayMs: number) => clock.advance(delayMs) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("wakes sleepers in order of their due time", async () => {
    const clock = createManualClock();
    const woken: string[] = [];
    const signal = new AbortController().signal;
    const late = clock.sleep(30, signal).then(() => woken.push("late"));
    const early = clock.sleep(10, signal).then(() => woken.push("early"));
    await clock.advance(30);
    await Promise.all([late, early]);
    expect(woken).toStrictEqual(["early", "late"]);
    expect(clock.now()).toBe(30);
  });
});
