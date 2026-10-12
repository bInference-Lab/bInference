import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createWakeUp } from "./wake-up.js";

const live = new AbortController().signal;

describe("wake up", () => {
  it("ends a wait when woken, and else when its time is up", async () => {
    const clock = createManualClock(0);
    const wake = createWakeUp(clock);
    const woken = wake.wait(1_000, live);
    wake.wake();
    await woken;
    expect(clock.now()).toBe(0);
    const timed = wake.wait(1_000, live);
    await clock.advance(1_000);
    await timed;
    expect(clock.now()).toBe(1_000);
  });

  it("ends the next wait at once after a wake with no wait under way", async () => {
    const clock = createManualClock(0);
    const wake = createWakeUp(clock);
    wake.wake();
    await wake.wait(1_000, live);
    expect(clock.now()).toBe(0);
  });

  it("stops a wait with the signal's reason", async () => {
    const wake = createWakeUp(createManualClock(0));
    const controller = new AbortController();
    const waiting = wake.wait(1_000, controller.signal);
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    await expect(wake.wait(1, controller.signal)).rejects.toBe(reason);
  });
});
