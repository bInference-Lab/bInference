import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createPendingCalls } from "./pending-calls.js";

const wait = { signal: new AbortController().signal, timeoutMs: 30_000 };

describe("createPendingCalls", () => {
  it("settles each call with its own reply", async () => {
    const calls = createPendingCalls(10);
    const first = calls.add(wait);
    const second = calls.add(wait);

    calls.settle({ kind: "reply", id: second.id, ok: true, value: "second" });
    calls.settle({
      kind: "reply",
      id: first.id,
      ok: false,
      error: { code: "store.busy", message: "busy", retryable: true, details: {} },
    });

    await expect(second.reply).resolves.toBe("second");
    await expect(first.reply).rejects.toMatchObject({ code: "store.busy", retryable: true });
  });

  it("refuses a call beyond its limit", () => {
    const calls = createPendingCalls(1);
    calls.add(wait);

    expect(() => calls.add(wait)).toThrow(
      expect.objectContaining({ code: "store.queue_full", retryable: true }),
    );
  });

  it("stops waiting when the caller aborts, and drops the late reply", async () => {
    const calls = createPendingCalls(1);
    const controller = new AbortController();
    const pending = calls.add({ signal: controller.signal, timeoutMs: 30_000 });

    controller.abort();
    calls.settle({ kind: "reply", id: pending.id, ok: true, value: "late" });

    await expect(pending.reply).rejects.toMatchObject({ code: "store.aborted" });
    expect(() => calls.add(wait)).not.toThrow();
  });

  it("names a wait that ran out of time", async () => {
    const calls = createPendingCalls(1);
    const timedOut = AbortSignal.abort(new DOMException("The wait ran out.", "TimeoutError"));

    await expect(calls.add({ signal: timedOut, timeoutMs: 30_000 }).reply).rejects.toMatchObject({
      code: "store.timeout",
    });
  });

  it("fails one call, or every call", async () => {
    const calls = createPendingCalls(3);
    const one = calls.add(wait);
    const two = calls.add(wait);
    const three = calls.add(wait);
    const fault = new BinferenceError({ code: "store.worker_failed", message: "stopped" });

    calls.fail(one.id, new BinferenceError({ code: "store.bad_request", message: "no clone" }));
    calls.failAll(fault);

    await expect(one.reply).rejects.toMatchObject({ code: "store.bad_request" });
    await expect(two.reply).rejects.toBe(fault);
    await expect(three.reply).rejects.toBe(fault);
  });
});
