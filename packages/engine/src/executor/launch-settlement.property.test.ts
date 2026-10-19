import { type Amount, assetRefSchema, type TxHash } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import { bookingOf, launchDeparturesOf } from "./launch-settlement.js";

// Decision 0234: a launch's first buy books its fee once, as the trade's fee when it spends the
// chain's coin and as network fee otherwise; a launch with no first buy books its fees as a
// departure. Either way, what leaves the wallet in the positions is what left it on chain.
const token = assetRefSchema.parse("fake:1/token:0x000000e1");
const txHash = `0x${"ab".repeat(32)}` as TxHash;

function quoteOf(feeBase: bigint, firstBuy: Amount | undefined): TokenLaunchQuote {
  const buy =
    firstBuy === undefined ? {} : { firstBuy: { spend: firstBuy, expectedOut: 1n, minOut: 1n } };
  return {
    venue: "fake-curve",
    settings: [],
    token,
    tokenDecimals: 18,
    fee: { asset: testCoin, base: feeBase },
    ...buy,
    image: {
      contentType: "image/png",
      bytes: 11,
      sha256: "a".repeat(64) as TokenLaunchQuote["image"]["sha256"],
    },
    metadataUri: "ipfs://fake-1",
    pin: null,
    pinWaitUntilMs: testNowMs,
    quotedAtMs: testNowMs,
  };
}

function launchRecord(quote: TokenLaunchQuote): IntentRecord {
  return {
    id: fixtureId("int", 1),
    agentId: testAgent,
    walletId: testWallet,
    kind: "launchToken",
    state: "finalized",
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: testNowMs,
    changedAtMs: testNowMs,
    version: 1,
    quote: tokenLaunchQuoteDocument.encode(quote),
  };
}

const base = fc.bigInt({ min: 0n, max: 10n ** 24n });

// What a booking takes out of the coin: what it sold of it, its fee, and its network fee.
function coinOut(trade: SettledTrade, feeBase: bigint): bigint {
  const sold = trade.amountIn.asset === testCoin ? trade.amountIn.base : 0n;
  return sold + feeBase + trade.gas.base;
}

// A launch's create call as it settled: what it took of an asset, and the network fee.
function settled(amountIn: Amount, gasBase: bigint): SettledTrade {
  return {
    amountIn,
    amountOut: { asset: token, base: 1n },
    gas: { asset: testCoin, base: gasBase },
    txHashes: [txHash],
    atMs: testNowMs,
  };
}

// What the positions book for a launch with a first buy: what it sold, and what left the coin.
function booked(feeBase: bigint, spend: Amount, trade: SettledTrade) {
  const booking = bookingOf(launchRecord(quoteOf(feeBase, spend)), trade);
  if (booking === undefined) {
    throw new Error("A launch with a first buy books a trade.");
  }
  return { sold: booking.trade.amountIn, coinOut: coinOut(booking.trade, booking.feeBase) };
}

const isWalletFee = (one: DepartureDraft): boolean =>
  one.sent.base > 0n && one.walletId === testWallet;

describe("a token launch's settlement in the positions", () => {
  it("books a coin first buy's spend as sold and the launch fee as its fee, once", () => {
    fc.assert(
      fc.property(base, base, base, (feeBase, spent, gasBase) => {
        const spend: Amount = { asset: testCoin, base: spent };
        const trade = settled({ asset: testCoin, base: spent + feeBase }, gasBase);
        expect(booked(feeBase, spend, trade)).toStrictEqual({
          sold: spend,
          coinOut: spent + feeBase + gasBase,
        });
      }),
    );
  });

  it("books a token first buy's launch fee with its network fee, once", () => {
    fc.assert(
      fc.property(base, base, base, (feeBase, spent, gasBase) => {
        const spend: Amount = { asset: testToken, base: spent };
        const trade = settled(spend, gasBase);
        expect(booked(feeBase, spend, trade)).toStrictEqual({
          sold: spend,
          coinOut: feeBase + gasBase,
        });
      }),
    );
  });

  it("takes a launch's fee and gas out as one departure when it buys nothing", () => {
    fc.assert(
      fc.property(base, base, (feeBase, gasBase) => {
        const record = launchRecord(quoteOf(feeBase, undefined));
        const gas = { asset: testCoin, base: gasBase };
        const trade: SettledTrade = {
          amountIn: { asset: testCoin, base: feeBase },
          amountOut: { asset: token, base: 0n },
          gas,
          txHashes: [txHash],
          atMs: testNowMs,
        };
        expect(bookingOf(record, trade)).toBeUndefined();
        const departures = launchDeparturesOf(record, { gas, atMs: testNowMs, txHash });
        const left = departures.reduce((sum, one) => sum + one.sent.base + one.gas.base, 0n);
        expect(left).toBe(feeBase + gasBase);
        expect(departures.every(isWalletFee)).toBe(true);
      }),
    );
  });

  it("takes nothing out as a departure for a launch with a first buy, or any other intent", () => {
    const gas = { asset: testCoin, base: 21_000n };
    const paid = { gas, atMs: testNowMs, txHash };
    const bought = launchRecord(quoteOf(2_000n, { asset: testCoin, base: 50n }));
    const swap = { ...bought, kind: "swap" as const };
    expect([launchDeparturesOf(bought, paid), launchDeparturesOf(swap, paid)]).toStrictEqual([
      [],
      [],
    ]);
  });
});
