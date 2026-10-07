import type { AssetRef, UsdPrice } from "@binference/chain";
import { bpsPerWhole, err, ok, type Result } from "@binference/core";
import type { Address } from "viem";
import type { FeedRound } from "./feed-round.schema.js";

/** A Chainlink USD feed: its proxy, the decimals of its answer and its published heartbeat. */
export interface UsdFeed {
  /** The feed's proxy. The aggregator behind it can change; the proxy stays. */
  readonly address: Address;
  readonly decimals: number;
  /** The longest time between two updates of the answer. */
  readonly heartbeatSeconds: number;
}

/** An asset a Chainlink feed prices, and how its price follows the feed. */
export interface FeedAsset {
  readonly asset: AssetRef;
  /** The asset's decimals: one whole unit is 10 to this power base units. */
  readonly decimals: number;
  /**
   * A stablecoin is worth $1 while its feed stays within 2% of $1, and the feed's answer once
   * the feed moves past 2%. Any other asset is worth the feed's answer.
   */
  readonly isStablecoin: boolean;
  readonly feed: UsdFeed;
}

/**
 * How long past its heartbeat an answer still counts. An answer reaches the chain some seconds
 * after its heartbeat (BNB/USD on BSC was seen 31 s old with a 27 s heartbeat), and the node and
 * the local clock can lag a few seconds more.
 */
export const staleMarginSeconds = 30;

const microsPerDollar = 1_000_000n;
const depegLimitBps = 200n;

function isStale(feed: UsdFeed, round: FeedRound, nowMs: number): boolean {
  const limitMs = BigInt(feed.heartbeatSeconds + staleMarginSeconds) * 1_000n;
  return BigInt(nowMs) - round.updatedAtSeconds * 1_000n > limitMs;
}

function isDepegged(feed: UsdFeed, answer: bigint): boolean {
  const dollar = 10n ** BigInt(feed.decimals);
  const gap = answer > dollar ? answer - dollar : dollar - answer;
  return gap * BigInt(bpsPerWhole) > dollar * depegLimitBps;
}

/**
 * The price of an asset from its feed's last round, read at `nowMs`: micro-dollars per base unit
 * as an exact ratio, so the caller's rounding is the only rounding. An answer of zero or less, or
 * one older than the heartbeat plus {@link staleMarginSeconds}, is `no_price`; an open round has
 * no update time, so it is stale too. A stablecoin's depeg past 2% is a strict test: a feed 2%
 * away still holds the peg.
 */
export function priceFromRound(
  priced: FeedAsset,
  round: FeedRound,
  nowMs: number,
): Result<UsdPrice, "no_price"> {
  const { feed } = priced;
  if (round.answer <= 0n || isStale(feed, round, nowMs)) {
    return err("no_price");
  }
  const perWhole = 10n ** BigInt(priced.decimals);
  return priced.isStablecoin && !isDepegged(feed, round.answer)
    ? ok({ numerator: microsPerDollar, denominator: perWhole })
    : ok({
        numerator: round.answer * microsPerDollar,
        denominator: 10n ** BigInt(feed.decimals) * perWhole,
      });
}
