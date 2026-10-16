import type { Amount, AssetRef } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { TokenLaunchQuote } from "../intents/token-launch-quote.js";
import { launchQuoteOf } from "./launch-queue-check.js";

const bpsWhole = bpsSchema.parse(10_000);
const noImpact = bpsSchema.parse(0);

/**
 * A token launch's confirmed quote as its settlement reads it: the first buy's spend in its pair
 * for the token, at its expected output and minimum, or the launch fee for nothing of the token
 * when it buys none. Its route is its launchpad's.
 */
export function launchTradeQuote(quote: TokenLaunchQuote): QuoteView {
  const { firstBuy, token, fee } = quote;
  const out = (base: bigint): Amount => ({ asset: token, base });
  const spend: Amount = firstBuy?.spend ?? fee;
  const native: AssetRef = fee.asset;
  return {
    route: [{ venue: quote.venue, shareBps: bpsWhole }],
    amountIn: spend,
    expectedOut: out(firstBuy?.expectedOut ?? 0n),
    minOut: out(firstBuy?.minOut ?? 0n),
    priceImpactBps: noImpact,
    gas: { asset: native, base: 0n },
    quotedAt: quote.quotedAtMs,
    expiresAt: quote.quotedAtMs,
  };
}

/** A launch's settled trade as the positions keep it, with the fee paid on top of what it sold. */
export interface LaunchBooking {
  readonly trade: SettledTrade;
  readonly feeBase: bigint;
}

/**
 * How a token launch's first buy enters the positions (decision 0234): the launch fee is the
 * trade's fee when the first buy spends the chain's coin, so the coin sold leaves it out, and
 * counts with the network fee otherwise, since a position keeps a fee in the asset it sold.
 */
function launchBookingOf(trade: SettledTrade, quote: TokenLaunchQuote): LaunchBooking {
  const { fee } = quote;
  if (trade.amountIn.asset === fee.asset) {
    const sold = trade.amountIn.base > fee.base ? trade.amountIn.base - fee.base : 0n;
    return { trade: { ...trade, amountIn: { asset: fee.asset, base: sold } }, feeBase: fee.base };
  }
  const gas = { asset: trade.gas.asset, base: trade.gas.base + fee.base };
  return { trade: { ...trade, gas }, feeBase: 0n };
}

/**
 * What a settled trade records in the positions: a trade as it is, a token launch's first buy as
 * the launch fee rule says, and nothing for a launch with no first buy, which opens no position.
 */
export function bookingOf(record: IntentRecord, trade: SettledTrade): LaunchBooking | undefined {
  const launch = launchQuoteOf(record);
  if (launch === undefined) {
    return { trade, feeBase: 0n };
  }
  return launch.firstBuy === undefined ? undefined : launchBookingOf(trade, launch);
}
