import { BinferenceError } from "@binference/core";
import type { CallFrame } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createPendingCalls } from "./pending-calls.js";

function call(id: string): CallFrame {
  return { t: "call", id, op: "intent/get", args: { intent: "int_1" } };
}

describe("createPendingCalls", () => {
  it("settles a call with the answer that names it and drops an answer to no call", async () => {
    const pending = createPendingCalls(4);
    const answer = pending.wait(call("1"), new AbortController().signal);
    pending.answer({ t: "reply", id: "9", result: {} });
    pending.answer({ t: "reply", id: "1", result: { state: "settled" } });
    await expect(answer).resolves.toStrictEqual({
      t: "reply",
      id: "1",
      result: { state: "settled" },
    });
    expect(pending.frames()).toStrictEqual([]);
  });

  it("keeps waiting calls in order so a new connection can send them again", () => {
    const pending = createPendingCalls(4);
    const signal = new AbortController().signal;
    void pending.wait(call("1"), signal);
    void pending.wait(call("2"), signal);
    expect(pending.frames().map((frame) => frame.id)).toStrictEqual(["1", "2"]);
  });

  it("refuses a call over the bound as busy and holds nothing", () => {
    const pending = createPendingCalls(1);
    const signal = new AbortController().signal;
    void pending.wait(call("1"), signal);
    expect(() => pending.wait(call("2"), signal)).toThrow(
      expect.objectContaining({ code: "client.busy", retryable: true }),
    );
    expect(pending.frames().map((frame) => frame.id)).toStrictEqual(["1"]);
  });

  it("drops a call whose signal aborts and frees its place", async () => {
    const pending = createPendingCalls(1);
    const controller = new AbortController();
    const answer = pending.wait(call("1"), controller.signal);
    controller.abort(new BinferenceError({ code: "core.timeout", message: "Late." }));
    await expect(answer).rejects.toMatchObject({ code: "core.timeout" });
    expect(pending.frames()).toStrictEqual([]);
    expect(() => pending.wait(call("2"), controller.signal)).toThrow(
      expect.objectContaining({ code: "core.timeout" }),
    );
  });

  it("rejects every waiting call and empties the map", async () => {
    const pending = createPendingCalls(4);
    const signal = new AbortController().signal;
    const first = pending.wait(call("1"), signal);
    const second = pending.wait(call("2"), signal);
    const closed = new BinferenceError({ code: "client.closed", message: "Closed." });
    pending.rejectAll(closed);
    await expect(first).rejects.toBe(closed);
    await expect(second).rejects.toBe(closed);
    expect(pending.frames()).toStrictEqual([]);
  });
});
