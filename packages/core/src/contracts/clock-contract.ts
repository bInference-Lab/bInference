import assert from "node:assert/strict";
import type { Clock } from "../ports.js";
import type { ContractCheck } from "./contract-check.js";

/** A clock under test, and how to make time pass for it. */
export interface ClockSubject {
  readonly clock: Clock;
  readonly advance: (delayMs: number) => Promise<void>;
}

/** Makes a fresh {@link ClockSubject} for each check. */
export interface ClockHarness {
  create(): ClockSubject;
}

// A sleeper of `delayMs` sleeps on 1 ms before its delay and wakes at it.
async function wakesAfter(harness: ClockHarness, delayMs: number): Promise<void> {
  const { clock, advance } = harness.create();
  const state = { isAwake: false };
  const sleeping = (async (): Promise<void> => {
    await clock.sleep(delayMs, new AbortController().signal);
    state.isAwake = true;
  })();
  await advance(delayMs - 1);
  assert.equal(state.isAwake, false);
  await advance(1);
  await sleeping;
  assert.equal(state.isAwake, true);
}

/** The contract every `Clock` adapter passes. */
export function clockContract(harness: ClockHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads whole epoch milliseconds that never go back",
      run: async () => {
        const { clock, advance } = harness.create();
        const first = clock.now();
        await advance(5);
        const second = clock.now();
        assert.ok(Number.isInteger(first) && first >= 0);
        assert.ok(second >= first + 5);
      },
    },
    {
      name: "wakes a sleeper once its delay has passed",
      run: async () => wakesAfter(harness, 100),
    },
    {
      name: "wakes a 30-day sleeper only once the 30 days have passed",
      run: async () => wakesAfter(harness, 30 * 24 * 60 * 60_000),
    },
    {
      name: "refuses to sleep on an aborted signal",
      run: async () => {
        const { clock } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(clock.sleep(10, AbortSignal.abort(reason)), reason);
      },
    },
    {
      name: "stops a sleep as soon as its signal aborts",
      run: async () => {
        const { clock } = harness.create();
        const controller = new AbortController();
        const reason = new Error("stopped");
        const sleeping = clock.sleep(60_000, controller.signal);
        controller.abort(reason);
        await assert.rejects(sleeping, reason);
      },
    },
  ];
}
