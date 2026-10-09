import { err, ok, type Result } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { LockReason } from "../unlock/unlock-keys.js";
import { createClosers } from "./closers.js";
import { startUnlockRetry } from "./unlock-retry.js";

const minuteMs = 60_000;

// A lock whose unlocks answer as the test lists them, then as the last one forever.
function retryWith(answers: readonly Result<void, LockReason>[]) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const calls: number[] = [];
  const state = { gaveUp: 0 };
  startUnlockRetry({
    lock: {
      unlock: async () => {
        calls.push(clock.now());
        return Promise.resolve(answers[calls.length - 1] ?? answers.at(-1) ?? ok(undefined));
      },
    },
    clock,
    random: createSeededRandom(3),
    closers,
    logger,
    onGiveUp: () => {
      state.gaveUp += 1;
    },
  });
  return { clock, closers, logger, calls, gaveUp: () => state.gaveUp };
}

describe("the signer step's retries after a start that found Privy out of reach", () => {
  it("unlocks once Privy answers, and tries no more", async () => {
    const run = retryWith([err("custody_unreachable"), ok(undefined)]);
    await run.clock.advance(5 * minuteMs);
    expect(run.calls).toHaveLength(2);
    expect(run.calls.every((atMs) => atMs > 0)).toBe(true);
    expect(run.gaveUp()).toBe(0);
    expect(run.logger.records().map((record) => record.event)).toStrictEqual([
      "engine.unlock_retried",
    ]);
  });

  it("tries five more times within five minutes, then says the engine stays locked", async () => {
    const run = retryWith([err("custody_unreachable")]);
    await run.clock.advance(10 * minuteMs);
    expect(run.calls.length).toBeGreaterThan(0);
    expect(run.calls.length).toBeLessThanOrEqual(5);
    expect(run.calls.every((atMs) => atMs <= 5 * minuteMs)).toBe(true);
    expect(run.gaveUp()).toBe(1);
  });

  it("stops at a cause waiting does not heal, without the notice", async () => {
    const run = retryWith([err("custody_unreachable"), err("app_secret_rejected")]);
    await run.clock.advance(10 * minuteMs);
    expect(run.calls).toHaveLength(2);
    expect(run.gaveUp()).toBe(0);
  });

  it("stops with its closer", async () => {
    const run = retryWith([err("custody_unreachable")]);
    await run.closers.closeAll(new AbortController().signal);
    await run.clock.advance(10 * minuteMs);
    expect([run.calls.length, run.gaveUp()]).toStrictEqual([0, 0]);
  });
});
