import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SendLevelState } from "../agents/send-level-record.js";
import type { SendLevel } from "./policy-rules.js";
import { looseningWaitMs, moveSendLevel, sendLevelAt } from "./send-level-change.js";

const nowMs = 1_800_000_000_000;
const levels = fc.constantFrom<SendLevel>(0, 1, 2, 3);
// Times around now and around a full wait put a pending level on each side of its time often.
const times = fc.integer({ min: nowMs - looseningWaitMs - 2, max: nowMs + looseningWaitMs + 2 });

const states: fc.Arbitrary<SendLevelState> = fc.oneof(
  levels.map((level) => ({ level })),
  fc
    .record({ level: levels, pending: fc.record({ level: levels, atMs: times }) })
    .filter((state) => state.pending.level < state.level),
);

/** One request for a level at a time, and a later time short of a full wait after it. */
interface Asked {
  readonly state: SendLevelState;
  readonly level: SendLevel;
  readonly atMs: number;
  readonly laterMs: number;
}

const asked: fc.Arbitrary<Asked> = fc
  .record({ state: states, level: levels, atMs: times, waitMs: fc.nat(looseningWaitMs - 1) })
  .map(({ state, level, atMs, waitMs }) => ({ state, level, atMs, laterMs: atMs + waitMs }));

// The level in effect short of a full wait after the move is no looser than before it, unless the
// level that already waited before the move reached its own time first.
function loosenedEarly({ state, level, atMs, laterMs }: Asked): boolean {
  const before = sendLevelAt(state, atMs).level;
  const later = sendLevelAt(moveSendLevel(state, level, atMs).next, laterMs).level;
  const waitedEnough = state.pending !== undefined && state.pending.atMs <= laterMs;
  return later < before && !(waitedEnough && later === state.pending?.level);
}

// A pending level the move leaves is looser than the level, and is either the one that already
// waited or one that waits a full 24 hours from the move.
function pendingIsSound({ state, level, atMs }: Asked): boolean {
  const { next } = moveSendLevel(state, level, atMs);
  const waited = sendLevelAt(state, atMs).pending;
  return (
    next.pending === undefined ||
    (next.pending.level < next.level &&
      (next.pending.atMs === waited?.atMs || next.pending.atMs === atMs + looseningWaitMs))
  );
}

// A settled state keeps a pending level only while its time is still to come.
function waitsAfter(settled: SendLevelState, atMs: number): boolean {
  return settled.pending === undefined || settled.pending.atMs > atMs;
}

describe("the send level rule", () => {
  it("never puts a looser level in effect before 24 hours after it was asked", () => {
    fc.assert(
      fc.property(asked, (request) => {
        expect(loosenedEarly(request)).toBe(false);
      }),
    );
  });

  it("calls a move a loosening exactly when it asks for a looser level than the one in effect", () => {
    fc.assert(
      fc.property(asked, ({ state, level, atMs }) => {
        const before = sendLevelAt(state, atMs).level;
        expect(moveSendLevel(state, level, atMs).loosens).toBe(level < before);
      }),
    );
  });

  it("puts a stricter level in effect at once", () => {
    fc.assert(
      fc.property(asked, ({ state, level, atMs }) => {
        const before = sendLevelAt(state, atMs).level;
        const { next } = moveSendLevel(state, level, atMs);
        expect(sendLevelAt(next, atMs).level).toBe(Math.max(before, level));
      }),
    );
  });

  it("leaves only a looser pending level, from its own wait", () => {
    fc.assert(
      fc.property(asked, (request) => {
        expect(pendingIsSound(request)).toBe(true);
      }),
    );
  });

  it("settles a state the same way however often it is read", () => {
    fc.assert(
      fc.property(states, times, (state, at) => {
        const settled = sendLevelAt(state, at);
        expect(sendLevelAt(settled, at)).toStrictEqual(settled);
        expect(waitsAfter(settled, at)).toBe(true);
      }),
    );
  });
});
