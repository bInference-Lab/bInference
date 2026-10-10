import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startGasCheckTimer } from "./gas-check-timer.js";

const minuteMs = 60_000;

function timerWith(options: { readonly isLocked?: { value: boolean }; readonly fails?: boolean }) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const checked: number[] = [];
  startGasCheckTimer({
    checkGas: async () => {
      checked.push(clock.now());
      return options.fails === true
        ? Promise.reject(new BinferenceError({ code: "rpc.timeout", message: "No answer." }))
        : Promise.resolve();
    },
    isLocked: () => options.isLocked?.value === true,
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, checked };
}

describe("the gas check timer", () => {
  it("checks the wallets' gas once a minute, and stops with its closer", async () => {
    const { clock, closers, checked } = timerWith({});
    await clock.advance(minuteMs);
    await clock.advance(minuteMs);
    expect(checked).toStrictEqual([minuteMs, 2 * minuteMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(minuteMs);
    expect(checked).toHaveLength(2);
  });

  it("skips a check while the engine is locked, and checks again once it opens", async () => {
    const locked = { value: true };
    const { clock, closers, checked } = timerWith({ isLocked: locked });
    await clock.advance(minuteMs);
    expect(checked).toStrictEqual([]);
    locked.value = false;
    await clock.advance(minuteMs);
    expect(checked).toStrictEqual([2 * minuteMs]);
    await closers.closeAll(new AbortController().signal);
  });

  it("logs a check that fails, and checks again a minute later", async () => {
    const { clock, closers, logger, checked } = timerWith({ fails: true });
    await clock.advance(minuteMs);
    await clock.advance(minuteMs);
    expect(checked).toHaveLength(2);
    expect(logger.records().map((record) => [record.event, record.fields.errorCode])).toStrictEqual(
      [
        ["engine.gas_check_failed", "rpc.timeout"],
        ["engine.gas_check_failed", "rpc.timeout"],
      ],
    );
    await closers.closeAll(new AbortController().signal);
  });
});
