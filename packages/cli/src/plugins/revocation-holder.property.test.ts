import type { Clock } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createListingSigner } from "./fake-listing-signer.js";
import { asPayload, listingIdFixture, revocationListFixture } from "./listing-fixtures.js";
import { createListingKeys } from "./listing-keys.js";
import type { RevocationList } from "./plugin-listing.schema.js";
import {
  createRevocationHolder,
  type RevocationFloor,
  type RevocationHolder,
} from "./revocation-holder.js";

const startMs = 1_767_261_600_000;
const signer = createListingSigner();
const keys = createListingKeys([signer.spki]);
const ids = [1, 2, 3, 4, 5].map(listingIdFixture);

/** One step of a run: a list the catalog answers after some time, or a restart from the lock. */
interface Step {
  readonly isRestart: boolean;
  readonly sequence: number;
  readonly revoked: RevocationList["revoked"];
  /** How long before the clock's now the list was signed; below zero, ahead of it. */
  readonly ageMs: number;
  readonly waitMs: number;
}

const step: fc.Arbitrary<Step> = fc.record({
  isRestart: fc.constantFrom(false, false, false, false, true),
  sequence: fc.integer({ min: 1, max: 6 }),
  revoked: fc.subarray(ids),
  ageMs: fc.integer({ min: -10 * 60_000, max: 2 * 3_600_000 }),
  waitMs: fc.integer({ min: 0, max: 20 * 60_000 }),
});

/** A run: the holder now, its clock, and every listing a list it took named. */
interface Run {
  /** Every holder of the run, one per start: the last is the engine's now. */
  readonly holders: RevocationHolder[];
  readonly time: { now: number };
  readonly clock: Clock;
  readonly named: Set<string>;
}

// A list signed for a step, at the run's time less the step's age.
const listOf = (run: Run, at: Step): RevocationList =>
  revocationListFixture({
    sequence: at.sequence,
    issuedAt: run.time.now - at.ageMs,
    revoked: at.revoked.toSorted(),
  });

// The run's holder now.
function holderOf(run: Run): RevocationHolder {
  const [holder] = run.holders.slice(-1);
  if (holder === undefined) {
    throw new Error("Expected a holder.");
  }
  return holder;
}

// The rules a taken list must keep against the floor before it and what was taken.
function takenRules(
  run: Run,
  list: RevocationList,
  floors: {
    readonly before: RevocationFloor | undefined;
    readonly after: RevocationFloor | undefined;
  },
): readonly string[] {
  const { before, after } = floors;
  const broken: string[] = [];
  if (before !== undefined && list.sequence < before.sequence) {
    broken.push("an older list was taken");
  }
  if (before?.sequence === list.sequence && after?.digest !== before.digest) {
    broken.push("a forked list was taken");
  }
  if ([...run.named].some((listing) => !list.revoked.some((named) => named === listing))) {
    broken.push("a list that leaves out a revoked listing was taken");
  }
  return broken;
}

// Feeds one step's list to the holder and answers each rule it broke.
function brokenAt(run: Run, at: Step): readonly string[] {
  const holder = holderOf(run);
  const before = holder.floor();
  const list = listOf(run, at);
  const taken = holder.take(signer.sign("pluginRevocations", asPayload(list)));
  const after = holder.floor();
  const fell = (after?.sequence ?? 0) < (before?.sequence ?? 0) ? ["the floor fell"] : [];
  if (!taken.ok) {
    return fell;
  }
  const broken = [...fell, ...takenRules(run, list, { before, after })];
  list.revoked.forEach((listing) => run.named.add(listing));
  return broken;
}

// A restart: a new holder that starts from the floor the lock kept. The floor names no listing,
// so the listings named before are kept across it by the lock's marks on its own entries
// (decision 0435), not by the holder: the run's named listings start again.
function restarted(run: Run): void {
  const next = createRevocationHolder({ keys, clock: run.clock });
  next.restore(holderOf(run).floor());
  run.holders.push(next);
  run.named.clear();
}

// Runs every step and answers each rule a step broke.
function brokenInRun(steps: readonly Step[]): readonly string[] {
  const time = { now: startMs };
  const clock: Clock = { now: () => time.now, sleep: async () => Promise.resolve() };
  const run: Run = {
    holders: [createRevocationHolder({ keys, clock })],
    time,
    clock,
    named: new Set(),
  };
  return steps.flatMap((at) => {
    time.now += at.waitMs;
    if (at.isRestart) {
      restarted(run);
      return [];
    }
    return brokenAt(run, at);
  });
}

describe("the revocation rules over any run of lists", () => {
  it("never lowers the floor, takes no older, forked or shrunk list, and lets no revoked listing pass", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        expect(brokenInRun(steps)).toStrictEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});
