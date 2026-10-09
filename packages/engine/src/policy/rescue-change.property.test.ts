import type { AccountRef } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cancelRescue, changeRescue, type RescueState, rescueAt } from "./rescue-change.js";
import { looseningWaitMs } from "./send-level-change.js";

const nowMs = 1_800_000_000_000;
const accounts = ["fake:1:a", "fake:1:b", "fake:1:c"] as AccountRef[];
const addresses = fc.constantFrom(...accounts);
// Times around now and around a full wait put a pending address on each side of its time often.
const times = fc.integer({ min: nowMs - looseningWaitMs - 2, max: nowMs + looseningWaitMs + 2 });

const states: fc.Arbitrary<RescueState> = fc.record(
  {
    rescueAddress: addresses,
    pendingRescue: fc.record({ address: addresses, atMs: times }),
  },
  { requiredKeys: [] },
);

/** One request for a rescue address at a time, and a later time short of a full wait after it. */
interface Asked {
  readonly state: RescueState;
  readonly address: AccountRef;
  readonly atMs: number;
  readonly laterMs: number;
}

const asked: fc.Arbitrary<Asked> = fc
  .record({ state: states, address: addresses, atMs: times, waitMs: fc.nat(looseningWaitMs - 1) })
  .map(({ state, address, atMs, waitMs }) => ({ state, address, atMs, laterMs: atMs + waitMs }));

// Short of a full wait after the change, a rescue pays the address in effect before it, or the
// one that already waited before the change and reached its own time.
function redirectedEarly({ state, address, atMs, laterMs }: Asked): boolean {
  const before = rescueAt(state, atMs).rescueAddress;
  const later = rescueAt(changeRescue(state, address, atMs), laterMs).rescueAddress;
  const waited = rescueAt(state, atMs).pendingRescue;
  return later !== before && !(waited !== undefined && waited.atMs <= laterMs);
}

// A pending address differs from the one in effect, and either already waited or waits a full
// 24 hours from the change.
function pendingIsSound({ state, address, atMs }: Asked): boolean {
  const next = changeRescue(state, address, atMs);
  const waited = rescueAt(state, atMs).pendingRescue;
  const { pendingRescue } = next;
  return (
    pendingRescue === undefined ||
    (pendingRescue.address !== next.rescueAddress &&
      (pendingRescue.atMs === waited?.atMs || pendingRescue.atMs === atMs + looseningWaitMs))
  );
}

describe("the rescue address rule", () => {
  it("never pays a new rescue address before 24 hours after it was asked", () => {
    fc.assert(
      fc.property(asked, (request) => {
        expect(redirectedEarly(request)).toBe(false);
      }),
    );
  });

  it("leaves only a pending address other than the one in effect, from its own wait", () => {
    fc.assert(
      fc.property(asked, (request) => {
        expect(pendingIsSound(request)).toBe(true);
      }),
    );
  });

  it("cancels only what waits, never the address in effect", () => {
    fc.assert(
      fc.property(states, times, (state, at) => {
        const cancelled = cancelRescue(state, at);
        expect(cancelled.pendingRescue).toBeUndefined();
        expect(cancelled.rescueAddress).toBe(rescueAt(state, at).rescueAddress);
      }),
    );
  });

  it("settles a state the same way however often it is read", () => {
    fc.assert(
      fc.property(states, times, (state, at) => {
        const settled = rescueAt(state, at);
        expect(rescueAt(settled, at)).toStrictEqual(settled);
      }),
    );
  });
});
