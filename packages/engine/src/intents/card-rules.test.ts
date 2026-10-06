import type { Bps } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CardRules, cardExpiresAt, isQuoteStale, isWorseThanTolerance } from "./card-rules.js";
import { intentKinds } from "./intent-kind.js";

const rules: CardRules = {
  tradeExpiryMs: 60_000,
  otherExpiryMs: 600_000,
  requoteAfterMs: 10_000,
  requoteToleranceBps: 50 as Bps,
};

describe("card expiry", () => {
  it("gives sends, DeFi, bridges, rescues and identity the longer card", () => {
    const expiries = intentKinds.map((kind) => [kind, cardExpiresAt(kind, 1_000, rules)]);
    expect(Object.fromEntries(expiries)).toStrictEqual({
      swap: 61_000,
      buy: 61_000,
      sell: 61_000,
      send: 601_000,
      revokeApproval: 61_000,
      lend: 601_000,
      stake: 601_000,
      bridge: 601_000,
      cexOrder: 61_000,
      registerIdentity: 601_000,
      launchToken: 61_000,
      rescue: 601_000,
    });
  });
});

describe("quote age", () => {
  it("finds a priced quote stale only once it is older than the re-quote age", () => {
    const quote = { quotedAtMs: 5_000, minOutBase: 1n };
    expect(isQuoteStale(quote, 15_000, rules)).toBe(false);
    expect(isQuoteStale(quote, 15_001, rules)).toBe(true);
  });

  it("never finds an unpriced quote stale", () => {
    expect(isQuoteStale({ quotedAtMs: 0 }, 1_000_000, rules)).toBe(false);
  });
});

describe("re-quote tolerance", () => {
  it("allows a drop of exactly the tolerance and no more", () => {
    const card = { quotedAtMs: 0, minOutBase: 200_000n };
    expect(isWorseThanTolerance(card, { quotedAtMs: 1, minOutBase: 199_000n }, rules)).toBe(false);
    expect(isWorseThanTolerance(card, { quotedAtMs: 1, minOutBase: 198_999n }, rules)).toBe(true);
  });

  it("never finds a re-quote worse than an unpriced card", () => {
    expect(isWorseThanTolerance({ quotedAtMs: 0 }, { quotedAtMs: 1, minOutBase: 0n }, rules)).toBe(
      false,
    );
  });

  it("finds a re-quote that lost its price worse", () => {
    const card = { quotedAtMs: 0, minOutBase: 1n };
    expect(isWorseThanTolerance(card, { quotedAtMs: 1 }, rules)).toBe(true);
  });

  it("matches the exact comparison for any amounts and tolerance", () => {
    const amount = fc.bigInt({ min: 0n, max: 10n ** 30n });
    const tolerance = fc.integer({ min: 0, max: 10_000 });
    fc.assert(
      fc.property(amount, amount, tolerance, (cardMin, requoteMin, toleranceBps) => {
        const exact = (cardMin - requoteMin) * 10_000n > cardMin * BigInt(toleranceBps);
        const custom = { ...rules, requoteToleranceBps: toleranceBps as Bps };
        const worse = isWorseThanTolerance(
          { quotedAtMs: 0, minOutBase: cardMin },
          { quotedAtMs: 0, minOutBase: requoteMin },
          custom,
        );
        expect(worse).toBe(exact);
      }),
    );
  });
});
