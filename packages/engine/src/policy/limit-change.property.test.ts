import { type AssetRef, assetRefSchema, chainRefSchema } from "@binference/chain";
import type { Bps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LimitsValues } from "../agents/limits-record.js";
import { testLimits } from "../intents/test-intents.js";
import {
  type LimitChanges,
  type LimitsState,
  limitsAt,
  limitsChanged,
  moveLimits,
} from "./limit-change.js";
import { looseningWaitMs } from "./send-level-change.js";

const nowMs = 1_800_000_000_000;
const chain = chainRefSchema.parse("fake:1");
const tokens = ["a", "b", "c"].map((name) => assetRefSchema.parse(`fake:1/token:${name}`));
const small = fc.bigInt({ min: 0n, max: 3n });
const bps = fc.integer({ min: 0, max: 3 }).map((value) => value as Bps);
const count = fc.integer({ min: 1, max: 3 });
const tokenList: fc.Arbitrary<readonly AssetRef[]> = fc.subarray(tokens);

const changesArbitrary: fc.Arbitrary<LimitChanges> = fc.record(
  {
    perTradeUsdMicros: small,
    rollingDayUsdMicros: small,
    slippageOtherBps: bps,
    liquidityFloorUsdMicros: small,
    minHealthFactorBp: count,
    gasReserve: small.map((reserveBase) => [{ chain, reserveBase }]),
    venues: fc.subarray(["v1", "v2", "v3"]),
    allowTokens: tokenList,
    denyTokens: tokenList,
    orderExpiryDays: count,
  },
  { requiredKeys: [] },
);

const base: LimitsValues = {
  ...testLimits,
  perTradeUsdMicros: 2n,
  rollingDayUsdMicros: 2n,
  slippageOtherBps: 2 as Bps,
  liquidityFloorUsdMicros: 2n,
  minHealthFactorBp: 2,
  gasReserve: [{ chain, reserveBase: 2n }],
  venues: ["v1", "v2"],
  allowTokens: [],
  denyTokens: [tokens[0] as AssetRef],
  orderExpiryDays: 2,
};

const states: fc.Arbitrary<LimitsState> = fc
  .tuple(changesArbitrary, fc.integer({ min: -looseningWaitMs, max: looseningWaitMs }))
  .map(
    ([changes, offsetMs]: readonly [LimitChanges, number]) =>
      moveLimits({ values: base }, changes, nowMs + offsetMs).next,
  );

// The limits a state holds once every one that waits applies.
function finalValues(state: LimitsState): LimitsValues {
  return state.pending?.values ?? state.values;
}

// Whether a state's waiting limits differ from the ones in effect, as any it keeps must.
function waitsForAChange(state: LimitsState): boolean {
  const { pending } = state;
  return pending === undefined || limitsChanged(state.values, pending.values).length > 0;
}

// Short of a full wait, the limits in effect hold no change that a stricter move would not make.
function loosenedEarly(state: LimitsState, changes: LimitChanges, waitMs: number): boolean {
  const before = limitsAt(state, nowMs).values;
  const move = moveLimits(state, changes, nowMs);
  const later = limitsAt(move.next, nowMs + waitMs).values;
  const earlier = state.pending !== undefined && state.pending.atMs <= nowMs + waitMs;
  return !earlier && limitsChanged(before, later).some((name) => !move.stricter.includes(name));
}

describe("the limits rule", () => {
  it("never puts a looser limit in effect before 24 hours after it was asked", () => {
    fc.assert(
      fc.property(
        states,
        changesArbitrary,
        fc.nat(looseningWaitMs - 1),
        (state, changes, waitMs) => {
          expect(loosenedEarly(state, changes, waitMs)).toBe(false);
        },
      ),
    );
  });

  it("puts every stricter change in effect at once, and makes every other one wait", () => {
    fc.assert(
      fc.property(states, changesArbitrary, (state, changes) => {
        const move = moveLimits(state, changes, nowMs);
        const asked = { ...limitsAt(state, nowMs).values, ...changes };
        const inEffect = limitsChanged(move.next.values, asked);
        expect(move.stricter.some((name) => inEffect.includes(name))).toBe(false);
        const unmet = limitsChanged(finalValues(move.next), asked);
        expect(unmet.filter((name) => name in changes)).toStrictEqual([]);
      }),
    );
  });

  it("leaves no pending limits that equal the limits in effect", () => {
    fc.assert(
      fc.property(states, changesArbitrary, (state, changes) => {
        expect(waitsForAChange(moveLimits(state, changes, nowMs).next)).toBe(true);
      }),
    );
  });
});
