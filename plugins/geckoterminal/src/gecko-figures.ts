import {
  type AssetRef,
  assetRefSchema,
  BinferenceError,
  type ChainRef,
  type MarketCandle,
  type MarketPool,
} from "@binference/plugin-sdk";
import { ratioOf, usdMicrosOf, wholeOf } from "@binference/plugin-sdk/data";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { GeckoCandleRow } from "./api/ohlcv-answer.schema.js";
import type { GeckoPool } from "./api/pool-answer.schema.js";

/** A fault for an answer that passed its schema but holds something no figure can be. */
export function badAnswer(problem: string): BinferenceError {
  return new BinferenceError({
    code: "geckoterminal.bad_answer",
    message: `GeckoTerminal answered outside its documented shape: ${problem}`,
  });
}

/** A token on the chain from its address, checksummed; anything else is a bad answer. */
export function tokenOn(chain: ChainRef, address: string): AssetRef {
  const parsed = parseEvmAddress(address);
  if (!parsed.ok) {
    throw badAnswer("a token address is not an address.");
  }
  return assetRefSchema.parse(`${chain}/erc20:${parsed.value}`);
}

// A token of the network from GeckoTerminal's id, `<network>_<address>`.
function tokenOfId(chain: ChainRef, network: string, id: string): AssetRef {
  const prefix = `${network}_`;
  if (!id.startsWith(prefix)) {
    throw badAnswer(`a token of another network came back for ${network}.`);
  }
  return tokenOn(chain, id.slice(prefix.length));
}

// A pool as GeckoTerminal names it on the chain: an address checksummed, a pool id in lowercase.
function poolIdOf(address: string): string {
  const parsed = parseEvmAddress(address);
  if (parsed.ok) {
    return parsed.value;
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(address)) {
    return address.toLowerCase();
  }
  throw badAnswer("a pool address is neither an address nor a pool id.");
}

/** Where the pools of an answer are: the chain and GeckoTerminal's name for its network. */
export interface PoolPlace {
  readonly chain: ChainRef;
  readonly network: string;
}

/**
 * A pool of an answer as a {@link MarketPool}, its figures exact; a figure GeckoTerminal left
 * out, or wrote as no number we read, is left out. The price change stays out: the docs do not
 * say which token of the pool it is of.
 */
export function marketPoolOf(pool: GeckoPool, place: PoolPlace): MarketPool {
  const priceUsd = ratioOf(pool.basePriceUsd);
  const liquidityUsdMicros = usdMicrosOf(pool.reserveUsd);
  const volume24hUsdMicros = usdMicrosOf(pool.volume24hUsd);
  const createdAtMs = pool.createdAt === undefined ? Number.NaN : Date.parse(pool.createdAt);
  return {
    dex: pool.dexId,
    pool: poolIdOf(pool.address),
    base: tokenOfId(place.chain, place.network, pool.baseTokenId),
    quote: tokenOfId(place.chain, place.network, pool.quoteTokenId),
    ...(priceUsd === undefined ? {} : { priceUsd }),
    ...(liquidityUsdMicros === undefined ? {} : { liquidityUsdMicros }),
    ...(volume24hUsdMicros === undefined ? {} : { volume24hUsdMicros }),
    ...(Number.isSafeInteger(createdAtMs) ? { createdAtMs } : {}),
  };
}

const depthOf = (pool: MarketPool): bigint => pool.liquidityUsdMicros ?? 0n;

/** Pools from the deepest down; pools of one depth keep GeckoTerminal's order. */
export function byDepth(pools: readonly MarketPool[]): readonly MarketPool[] {
  return pools.toSorted((left, right) => {
    const gap = depthOf(right) - depthOf(left);
    if (gap > 0n) {
      return 1;
    }
    return gap < 0n ? -1 : 0;
  });
}

/** One row of an OHLCV answer as a candle, every figure exact; a row we cannot read is a fault. */
export function candleOf(row: GeckoCandleRow): MarketCandle {
  const seconds = wholeOf(row.timestamp);
  const [open, high, low, close] = [row.open, row.high, row.low, row.close].map(ratioOf);
  const volumeUsdMicros = usdMicrosOf(row.volume);
  if (
    seconds === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    volumeUsdMicros === undefined
  ) {
    throw badAnswer("an OHLCV row holds a figure that is no price, volume or time.");
  }
  return { atMs: seconds * 1_000, open, high, low, close, volumeUsdMicros };
}
