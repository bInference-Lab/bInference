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

  it("reports the loop, the memory, the log file and each missing part as failed", () => {
    const state = { failed: false };
    const probe = startHealthProbe({
      missing: ["custody", "prices"],
      logFailed: () => state.failed,
    });
    const first = probe.read();
    state.failed = true;
    const second = probe.read();
    probe.stop();
    expect(first.map((signal) => signal.signal)).toStrictEqual([
      "event_loop",
      "memory",
      "logs",
      "custody",
      "prices",
    ]);
    expect(first.slice(2)).toStrictEqual([
      { signal: "logs", state: "ok" },
      { signal: "custody", state: "fail" },
      { signal: "prices", state: "fail" },
    ]);
    expect(second[2]).toStrictEqual({ signal: "logs", state: "warn" });
  });

  it("reads each part's own state after the log file, before the missing parts", () => {
    const executor = { state: "ok" as "ok" | "warn" | "fail" };
    const probe = startHealthProbe({
      missing: ["custody"],
      parts: [{ signal: "executor", state: () => executor.state }],
      logFailed: () => false,
    });
    const first = probe.read();
    executor.state = "fail";
    const second = probe.read();
    probe.stop();
    expect(first.slice(3)).toStrictEqual([
      { signal: "executor", state: "ok" },
      { signal: "custody", state: "fail" },
    ]);
    expect(second[3]).toStrictEqual({ signal: "executor", state: "fail" });
  });
});
