import { createManualClock } from "@binference/core/testing";
import type { RouteLine } from "@binference/runtime";
import { describe, expect, it } from "vitest";
import { createRouteCalls, type RouteRequest, routeLimits } from "./route-calls.js";

const request: RouteRequest = { op: "notes/list", args: { agent: "agt_x" }, origin: "owner" };
const signal = new AbortController().signal;

function routes() {
  const clock = createManualClock(0);
  const sent: RouteLine[] = [];
  const calls = createRouteCalls({ write: async (line) => void sent.push(line), clock });
  return { calls, sent, clock };
}

describe("createRouteCalls", () => {
  it("writes each call on a route line and hands each reply to the call with its id", async () => {
    const { calls, sent, clock } = routes();
    const first = calls.send(request, signal);
    const second = calls.send({ ...request, op: "notes/search" }, signal);
    await clock.advance(0);
    expect(sent.map(({ id, op, origin }) => [id, op, origin])).toStrictEqual([
      ["r1", "notes/list", "owner"],
      ["r2", "notes/search", "owner"],
    ]);
    calls.answer({ t: "routeReply", id: "r2", result: { items: [] } });
    calls.answer({ t: "routeReply", id: "r9", result: 1 });
    const error = { code: "protocol.unknown_op", message: "No.", retryable: false } as const;
    calls.answer({ t: "routeReply", id: "r1", error });
    await expect(second).resolves.toStrictEqual({ ok: true, value: { items: [] } });
    await expect(first).resolves.toStrictEqual({ ok: false, error: "protocol.unknown_op" });
  });

  it("fails a code the protocol does not know as an internal error", async () => {
    const { calls, clock } = routes();
    const call = calls.send(request, signal);
    await clock.advance(0);
    const error = { code: "runtime.something_new", message: "No.", retryable: false } as const;
    calls.answer({ t: "routeReply", id: "r1", error });
    await expect(call).resolves.toStrictEqual({ ok: false, error: "internal.error" });
  });

  it("fails a call with no reply within 10 seconds, and ignores its late reply", async () => {
    const { calls, clock } = routes();
    const call = calls.send(request, signal);
    await clock.advance(routeLimits.replyTimeoutMs);
    await expect(call).resolves.toStrictEqual({ ok: false, error: "engine.timeout" });
    calls.answer({ t: "routeReply", id: "r1", result: 1 });
  });

  it("runs 8 calls at once, lets 64 wait, and refuses one more as busy", async () => {
    const { calls, sent, clock } = routes();
    const total = routeLimits.running + routeLimits.waiting;
    const pending = Array.from({ length: total }, async () => calls.send(request, signal));
    await expect(calls.send(request, signal)).resolves.toStrictEqual({
      ok: false,
      error: "protocol.busy",
    });
    await clock.advance(0);
    expect(sent).toHaveLength(routeLimits.running);
    calls.answer({ t: "routeReply", id: "r1", result: null });
    await clock.advance(0);
    expect(sent.map((line) => line.id).at(-1)).toBe("r9");
    calls.failAll();
    const outcomes = await Promise.all(pending);
    expect(outcomes[0]).toStrictEqual({ ok: true, value: null });
    expect(outcomes.slice(1)).toStrictEqual(
      Array.from({ length: total - 1 }, () => ({ ok: false, error: "runtime.unavailable" })),
    );
  });

  it("fails every call, running, waiting or new, once the runtime is gone", async () => {
    const { calls } = routes();
    const running = calls.send(request, signal);
    calls.failAll();
    await expect(running).resolves.toStrictEqual({ ok: false, error: "runtime.unavailable" });
    await expect(calls.send(request, signal)).resolves.toStrictEqual({
      ok: false,
      error: "runtime.unavailable",
    });
  });

  it("fails a call whose line cannot be written as the runtime gone", async () => {
    const clock = createManualClock(0);
    const calls = createRouteCalls({
      write: async () => Promise.reject(new Error("The pipe is closed.")),
      clock,
    });
    await expect(calls.send(request, signal)).resolves.toStrictEqual({
      ok: false,
      error: "runtime.unavailable",
    });
  });
});
