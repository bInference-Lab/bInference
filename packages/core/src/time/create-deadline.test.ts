import { describe, expect, it } from "vitest";
import { createManualClock } from "../fakes/manual-clock.js";
import { createDeadline } from "./create-deadline.js";

describe("createDeadline", () => {
  it("aborts with a retryable timeout once its time runs out", async () => {
    const clock = createManualClock();
    const deadline = createDeadline({
      clock,
      signal: new AbortController().signal,
      timeoutMs: 500,
    });
    await clock.advance(499);
    expect(deadline.signal.aborted).toBe(false);
    await clock.advance(1);
    expect(deadline.signal.reason).toMatchObject({ code: "core.timeout", retryable: true });
  });

  it("aborts with the parent's reason when the parent aborts first", async () => {
    const clock = createManualClock();
    const parent = new AbortController();
    const deadline = createDeadline({ clock, signal: parent.signal, timeoutMs: 500 });
    const reason = new Error("owner stopped");
    parent.abort(reason);
    expect(deadline.signal.reason).toBe(reason);
    await clock.advance(1_000);
    expect(deadline.signal.reason).toBe(reason);
  });

  it("starts aborted when the parent already is", () => {
    const reason = new Error("stopped");
    const deadline = createDeadline({
      clock: createManualClock(),
      signal: AbortSignal.abort(reason),
      timeoutMs: 500,
    });
    expect(deadline.signal.reason).toBe(reason);
  });

  it("never fires after it is cleared", async () => {
    const clock = createManualClock();
    const parent = new AbortController();
    const deadline = createDeadline({ clock, signal: parent.signal, timeoutMs: 500 });
    deadline.clear();
    await clock.advance(1_000);
    parent.abort(new Error("late"));
    expect(deadline.signal.aborted).toBe(false);
  });
});
