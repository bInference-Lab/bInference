import { assetRefSchema } from "@binference/chain";
import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { addressSchema } from "../rpc/evm-wire.schema.js";
import { type FeedAsset, priceFromRound, staleMarginSeconds } from "./price-from-round.js";

const feed = {
  address: addressSchema.parse("0xB97Ad0E74fa7d920791E90258A6E2085088b4320"),
  decimals: 8,
  heartbeatSeconds: 900,
};
const stablecoin: FeedAsset = {
  asset: assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955"),
  decimals: 18,
  isStablecoin: true,
  feed,
};
const coin: FeedAsset = {
  asset: assetRefSchema.parse("eip155:56/slip44:714"),
  decimals: 18,
  isStablecoin: false,
  feed: { ...feed, heartbeatSeconds: 27 },
};

const updatedAtSeconds = 1_791_377_294n;
const updatedAtMs = 1_791_377_294_000;
const nowMs = updatedAtMs + 60_000;
const dollar = ok({ numerator: 1_000_000n, denominator: 10n ** 18n });

function atAnswer(answer: bigint) {
  return priceFromRound(stablecoin, { answer, updatedAtSeconds }, nowMs);
}

function feedAnswer(answer: bigint) {
  return ok({ numerator: answer * 1_000_000n, denominator: 10n ** 26n });
}

describe("a price from a feed's round", () => {
  it("counts a stablecoin as $1 up to 2% away from $1 either way", () => {
    expect([atAnswer(98_000_000n), atAnswer(100_000_000n), atAnswer(102_000_000n)]).toStrictEqual([
      dollar,
      dollar,
      dollar,
    ]);
  });

  it("switches a stablecoin to its feed's answer once the feed moves past 2%", () => {
    expect(atAnswer(97_999_999n)).toStrictEqual(feedAnswer(97_999_999n));
    expect(atAnswer(102_000_001n)).toStrictEqual(feedAnswer(102_000_001n));
  });

  it("prices any other asset at its feed's answer", () => {
    const round = { answer: 76_635_431_000n, updatedAtSeconds };
    expect(priceFromRound(coin, round, updatedAtMs)).toStrictEqual(feedAnswer(76_635_431_000n));
  });

  it.each([0n, -1n])("has no price for an answer of %d", (answer) => {
    expect(atAnswer(answer)).toStrictEqual(err("no_price"));
  });

  it("keeps a price through the heartbeat and the margin, and not a millisecond longer", () => {
    const limitMs = (feed.heartbeatSeconds + staleMarginSeconds) * 1_000;
    const round = { answer: 99_967_551n, updatedAtSeconds };
    expect(priceFromRound(stablecoin, round, updatedAtMs + limitMs)).toStrictEqual(dollar);
    expect(priceFromRound(stablecoin, round, updatedAtMs + limitMs + 1)).toStrictEqual(
      err("no_price"),
    );
  });

  it("has no price for a round still open, which carries no update time", () => {
    const round = { answer: 99_967_551n, updatedAtSeconds: 0n };
    expect(priceFromRound(stablecoin, round, nowMs)).toStrictEqual(err("no_price"));
  });

  it("keeps a price whose update time is ahead of the local clock", () => {
    const round = { answer: 99_967_551n, updatedAtSeconds: updatedAtSeconds + 5n };
    expect(priceFromRound(stablecoin, round, updatedAtMs)).toStrictEqual(dollar);
  });
});
