import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AccountNonces, isNonceFree, lowestFreeNonce } from "./lowest-free-nonce.js";

interface Case {
  readonly chainNonce: number;
  readonly nonces: AccountNonces;
}

// Small ranges, so the chain's count, the block floor and the held nonces often meet.
const caseArbitrary: fc.Arbitrary<Case> = fc.record({
  chainNonce: fc.nat({ max: 40 }),
  nonces: fc.record({
    blockFloor: fc.nat({ max: 40 }),
    held: fc.array(fc.nat({ max: 60 }), { maxLength: 30 }),
    given: fc.nat({ max: 80 }),
  }),
});

describe("the lowest free nonce rule", () => {
  it("gives a free nonce at or above the chain's count and the block floor", () => {
    fc.assert(
      fc.property(caseArbitrary, ({ chainNonce, nonces }) => {
        const { nonce } = lowestFreeNonce(chainNonce, nonces);
        expect(nonce).toBeGreaterThanOrEqual(chainNonce);
        expect(nonce).toBeGreaterThanOrEqual(nonces.blockFloor);
        expect(nonces.held).not.toContain(nonce);
        expect(isNonceFree(nonce, nonces)).toBe(true);
      }),
    );
  });

  it("leaves no gap: every nonce between the start and the one given is held", () => {
    fc.assert(
      fc.property(caseArbitrary, ({ chainNonce, nonces }) => {
        const { nonce } = lowestFreeNonce(chainNonce, nonces);
        const start = Math.max(chainNonce, nonces.blockFloor);
        const skipped = Array.from({ length: nonce - start }, (_, index) => start + index);
        expect(skipped.every((held) => nonces.held.includes(held))).toBe(true);
      }),
    );
  });

  it("says a nonce refills a gap exactly when the queue gave it or a later one before", () => {
    fc.assert(
      fc.property(caseArbitrary, ({ chainNonce, nonces }) => {
        const grant = lowestFreeNonce(chainNonce, nonces);
        expect(grant.refillsGap).toBe(grant.nonce < nonces.given);
      }),
    );
  });

  it("never lets a transaction take a held nonce or one below the block floor", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.nat({ max: 60 }), ({ nonces }, nonce) => {
        expect(nonces.held.filter((held) => isNonceFree(held, nonces))).toStrictEqual([]);
        expect(isNonceFree(Math.min(nonce, nonces.blockFloor - 1), nonces)).toBe(false);
        expect(isNonceFree(Math.max(nonce, ...nonces.held, nonces.blockFloor) + 1, nonces)).toBe(
          true,
        );
      }),
    );
  });

  it("gives nonces one after another as each is held, from any start", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.integer({ min: 1, max: 40 }), ({ chainNonce }, count) => {
        const given = Array.from({ length: count }).reduce<readonly number[]>(
          (held) => [...held, lowestFreeNonce(chainNonce, { blockFloor: 0, held, given: 0 }).nonce],
          [],
        );
        expect(given).toStrictEqual(
          Array.from({ length: count }, (_, index) => chainNonce + index),
        );
      }),
    );
  });
});
