import {
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  BinferenceError,
  type ChainRef,
  type Clock,
  defineData,
  err,
  type Http,
  type MarketDataSource,
  type MarketPool,
  ok,
  type TrendingToken,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { DexBoost } from "./api/boost-answer.schema.js";
import { createDexscreenerApi, tokensPerRequest } from "./api/dexscreener-api.js";
import type { DexPair } from "./api/pair-answer.schema.js";
import { changeBpsOf, ratioOf, usdMicrosOf, wholeOf } from "./market-figures.js";

/** What the DEX Screener source is made from. */
export interface DexscreenerOptions {
  /** Reaches DEX Screener's public API, which answers without a key. */
  readonly http: Http;
  /** Paces the requests under DEX Screener's published limits. */
  readonly clock: Clock;
  /**
   * The longest a read waits for its turn under the limits, a 429's pause included, before it
   * fails as rate limited. One minute, the limits' window, unless given.
   */
  readonly maxWaitMs?: number;
}

// The chains the source serves, by their CAIP-2 id: DEX Screener's id for each.
const dexChainIds: ReadonlyMap<string, string> = new Map([["eip155:56", "bsc"]]);
const defaultMaxWaitMs = 60_000;

function badPair(problem: string): BinferenceError {
  return new BinferenceError({
    code: "dexscreener.bad_answer",
    message: `DEX Screener answered a pair outside its documented shape: ${problem}`,
  });
}

// A token address of an EVM chain in its checksummed form, or a fault for an answer that holds
// something else where an address belongs.
function evmAddress(text: string): string {
  const address = parseEvmAddress(text);
  if (!address.ok) {
    throw badPair("a token address is not an address.");
  }
  return address.value;
}

const tokenOn = (chain: ChainRef, address: string): AssetRef =>
  assetRefSchema.parse(`${chain}/erc20:${evmAddress(address)}`);

// A pool's id as DEX Screener names it: an address checksummed, a longer pool id in lowercase.
function poolOf(text: string): string {
  const address = parseEvmAddress(text);
  if (address.ok) {
    return address.value;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw badPair("a pair address is neither an address nor a pool id.");
  }
  return text.toLowerCase();
}

// The figures of a pair the source could read exactly; one it could not is left out.
function figuresOf(pair: DexPair): Partial<MarketPool> {
  const priceUsd = ratioOf(pair.priceUsd);
  const liquidityUsdMicros = usdMicrosOf(pair.liquidityUsd);
  const volume24hUsdMicros = usdMicrosOf(pair.volume24hUsd);
  const change24hBps = changeBpsOf(pair.change24hPercent);
  const createdAtMs = wholeOf(pair.createdAtMs);
  return {
    ...(priceUsd === undefined ? {} : { priceUsd }),
    ...(liquidityUsdMicros === undefined ? {} : { liquidityUsdMicros }),
    ...(volume24hUsdMicros === undefined ? {} : { volume24hUsdMicros }),
    ...(change24hBps === undefined ? {} : { change24hBps }),
    ...(createdAtMs === undefined ? {} : { createdAtMs }),
  };
}

// A pair on the chain asked about, read into a pool; a pair whose quote token has no address,
// which DEX Screener's schema allows, names no pool and is left out.
function marketPoolOf(pair: DexPair, chain: ChainRef, dexChainId: string): MarketPool | undefined {
  if (pair.chainId !== dexChainId) {
    throw badPair(`a pair of ${pair.chainId} came back for ${dexChainId}.`);
  }
  if (pair.quoteAddress === undefined) {
    return undefined;
  }
  return {
    dex: pair.dexId,
    pool: poolOf(pair.pairAddress),
    base: tokenOn(chain, pair.baseAddress),
    quote: tokenOn(chain, pair.quoteAddress),
    ...figuresOf(pair),
  };
}

const depthOf = (pool: MarketPool): bigint => pool.liquidityUsdMicros ?? 0n;

// Orders pools from the deepest down.
function deeperFirst(left: MarketPool, right: MarketPool): number {
  if (depthOf(left) > depthOf(right)) {
    return -1;
  }
  return depthOf(left) < depthOf(right) ? 1 : 0;
}

// Deepest first; pools of one depth keep DEX Screener's order.
function deepestFirst(pools: readonly MarketPool[]): readonly MarketPool[] {
  return pools.toSorted(deeperFirst);
}

// The tokens a boosts list ranks on the chain, each once, in its order, at most one request's.
function boostedOn(
  boosts: readonly DexBoost[],
  chain: ChainRef,
  dexChainId: string,
): readonly (readonly [AssetRef, DexBoost])[] {
  const ranked = new Map<AssetRef, DexBoost>();
  for (const boost of boosts.filter((item) => item.chainId === dexChainId)) {
    const asset = tokenOn(chain, boost.tokenAddress);
    if (!ranked.has(asset)) {
      ranked.set(asset, boost);
    }
  }
  return [...ranked].slice(0, tokensPerRequest);
}

// One trending token: its deepest pool when DEX Screener lists one, and its active boosts.
function trendingOf(
  [asset, boost]: readonly [AssetRef, DexBoost],
  pools: readonly MarketPool[],
): TrendingToken {
  const pool = pools.find((each) => each.base === asset || each.quote === asset);
  const activeBoosts = wholeOf(boost.totalAmount);
  return {
    asset,
    ...(pool === undefined ? {} : { pool }),
    ...(activeBoosts === undefined ? {} : { activeBoosts }),
  };
}

/**
 * Creates the `dexscreener` data source over DEX Screener's public API, keyless, on BNB Smart
 * Chain. A token's pools come from `/token-pairs/v1`, deepest first. The trending tokens are
 * DEX Screener's tokens with the most active boosts (`/token-boosts/top/v1`) on the chain, in its
 * order, each with its deepest pool from `/tokens/v1` and its active boosts, since that ranking
 * is paid promotion. Another chain is `not_covered`. Figures stay exact: numbers are read from
 * the answer's own text, never through a floating-point number.
 */
export function createDexscreenerSource(options: DexscreenerOptions): MarketDataSource {
  const api = createDexscreenerApi({
    http: options.http,
    clock: options.clock,
    maxWaitMs: options.maxWaitMs ?? defaultMaxWaitMs,
  });
  return defineData({
    id: "dexscreener",
    async pools(asset, { signal }) {
      signal.throwIfAborted();
      const { chain, assetNamespace, assetReference } = assetRefParts(asset);
      const dexChainId = dexChainIds.get(chain);
      const address = parseEvmAddress(assetReference);
      if (dexChainId === undefined || assetNamespace !== "erc20" || !address.ok) {
        return err("not_covered");
      }
      const token = tokenOn(chain, address.value);
      const pairs = await api.tokenPairs(dexChainId, address.value, signal);
      const pools = pairs.flatMap((pair) => marketPoolOf(pair, chain, dexChainId) ?? []);
      return ok(deepestFirst(pools.filter((pool) => pool.base === token || pool.quote === token)));
    },
    async trending(chain, { signal }) {
      signal.throwIfAborted();
      const dexChainId = dexChainIds.get(chain);
      if (dexChainId === undefined) {
        return err("not_covered");
      }
      const ranked = boostedOn(await api.topBoosts(signal), chain, dexChainId);
      const addresses = ranked.map(([asset]) => assetRefParts(asset).assetReference);
      const pairs = addresses.length === 0 ? [] : await api.tokens(dexChainId, addresses, signal);
      const pools = deepestFirst(
        pairs.flatMap((pair) => marketPoolOf(pair, chain, dexChainId) ?? []),
      );
      return ok(ranked.map((entry) => trendingOf(entry, pools)));
    },
  });
}
