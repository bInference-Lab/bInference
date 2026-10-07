import assert from "node:assert/strict";
import { assetRefSchema } from "@binference/chain";
import { mulDiv } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addressSchema } from "../rpc/evm-wire.schema.js";
import { type FeedAsset, priceFromRound } from "./price-from-round.js";

const asset = assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955");
const address = addressSchema.parse("0xB97Ad0E74fa7d920791E90258A6E2085088b4320");
const updatedAtSeconds = 1_791_377_294n;
const nowMs = 1_791_377_294_000;

const priced = fc.record({
  feedDecimals: fc.integer({ min: 0, max: 18 }),
  assetDecimals: fc.integer({ min: 0, max: 24 }),
  isStablecoin: fc.boolean(),
});

function feedAsset(item: Case): FeedAsset {
  return {
    asset,
    decimals: item.assetDecimals,
    isStablecoin: item.isStablecoin,
    feed: { address, decimals: item.feedDecimals, heartbeatSeconds: 60 },
  };
}

interface Case {
  readonly feedDecimals: number;
  readonly assetDecimals: number;
  readonly isStablecoin: boolean;
}

// The rule restated from decision 0059: a stablecoin holds $1 within 2% of it, and anything else
// is worth the feed's answer. This is one whole unit's value in micro-dollars.
function wholeUsdMicrosOf(item: Case, answer: bigint): bigint {
  const dollar = 10n ** BigInt(item.feedDecimals);
  const gap = answer > dollar ? answer - dollar : dollar - answer;
  return item.isStablecoin && gap * 50n <= dollar
    ? 1_000_000n
    : mulDiv(answer, { numerator: 1_000_000n, denominator: dollar }, "down");
}

// Answers anywhere, and answers within 3% of $1 so the 2% edge is crossed often.
function answers(feedDecimals: number): fc.Arbitrary<bigint> {
  const dollar = 10n ** BigInt(feedDecimals);
  const nearDollar = fc
    .tuple(fc.integer({ min: -300, max: 300 }), fc.bigInt({ min: -1n, max: 1n }))
    .map(([bps, nudge]) => dollar + (dollar * BigInt(bps)) / 10_000n + nudge)
    .filter((answer) => answer > 0n);
  return fc.oneof(fc.bigInt({ min: 1n, max: 10n ** 30n }), nearDollar);
}

const cases = priced.chain((item) => fc.tuple(fc.constant(item), answers(item.feedDecimals)));

describe("a price from a feed's round", () => {
  it("values one whole unit at the feed's answer, or at $1 for a stablecoin that holds its peg", () => {
    fc.assert(
      fc.property(cases, ([item, answer]) => {
        const price = priceFromRound(feedAsset(item), { answer, updatedAtSeconds }, nowMs);
        const whole = 10n ** BigInt(item.assetDecimals);
        assert.ok(price.ok);
        expect(mulDiv(whole, price.value, "down")).toBe(wholeUsdMicrosOf(item, answer));
      }),
    );
  });
});
