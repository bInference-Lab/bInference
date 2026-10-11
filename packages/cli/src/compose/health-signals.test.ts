import { describe, expect, it } from "vitest";
import { lagState, memoryState, startHealthProbe } from "./health-signals.js";

const mebibyte = 1024 * 1024;

describe("the health signals", () => {
  it.each([
    [0, "ok"],
    [99, "ok"],
    [100, "warn"],
    [999, "warn"],
    [1_000, "fail"],
  ])("reads an event-loop lag of %d ms as %s", (lagMs, state) => {
    expect(lagState(lagMs)).toBe(state);
  });

  it.each([
    [200 * mebibyte, "ok"],
    [300 * mebibyte, "warn"],
    [1024 * mebibyte, "fail"],
  ])("reads %d resident bytes as %s", (bytes, state) => {
    expect(memoryState(bytes)).toBe(state);
  });

  it("reports the loop, the memory and the log file, then each part's own state", () => {
    const state = { failed: false };
    const rpc = { state: "ok" as "ok" | "warn" | "fail" };
    const probe = startHealthProbe({
      parts: [
        { signal: "executor", state: () => "ok" },
        { signal: "rpc", state: () => rpc.state },
      ],
      logFailed: () => state.failed,
    });
    const first = probe.read();
    state.failed = true;
    rpc.state = "fail";
    const second = probe.read();
    probe.stop();
    expect(first.map((signal) => signal.signal)).toStrictEqual([
      "event_loop",
      "memory",
      "logs",
      "executor",
      "rpc",
    ]);
    expect(first.slice(2)).toStrictEqual([
      { signal: "logs", state: "ok" },
      { signal: "executor", state: "ok" },
      { signal: "rpc", state: "ok" },
    ]);
    expect(second.slice(2)).toStrictEqual([
      { signal: "logs", state: "warn" },
      { signal: "executor", state: "ok" },
      { signal: "rpc", state: "fail" },
    ]);
  });

  it("says since when a part that is not ok stopped being ok", () => {
    const runtime = { state: "fail" as "ok" | "warn" | "fail" };
    const probe = startHealthProbe({
      parts: [{ signal: "runtime", state: () => runtime.state, since: () => 5_000 }],
      logFailed: () => false,
    });
    const down = probe.read().at(-1);
    runtime.state = "ok";
    const back = probe.read().at(-1);
    probe.stop();
    expect(down).toStrictEqual({ signal: "runtime", state: "fail", since: 5_000 });
    expect(back).toStrictEqual({ signal: "runtime", state: "ok" });
  });
});
