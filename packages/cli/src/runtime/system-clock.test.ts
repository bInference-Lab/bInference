import { clockContract } from "@binference/core/testing";
import { describe, expect, it, vi } from "vitest";
import { createSystemClock } from "./system-clock.js";

// The test setup fakes the timers and Date, so time moves only as each check advances it.
describe("the system clock", () => {
  it.each(
    clockContract({
      create: () => ({
        clock: createSystemClock(),
        advance: async (delayMs: number) => {
          await vi.advanceTimersByTimeAsync(delayMs);
        },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
