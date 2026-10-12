import { type AssetRef, assetRefParts, type PriceRead, type PriceReader } from "@binference/chain";
import { type Clock, err, ok, type Ratio } from "@binference/core";
import { type Address, type Hex, zeroAddress } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import { evmAccountRef, type EvmChain } from "../evm-chain.js";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import {
  addressAnswer,
  isToken0,
  pairCallData,
  poolCallData,
  type PoolKind,
  type PoolPlace,
  poolPrice,
  poolReadCalls,
  poolState,
} from "./pool-state.js";
import { quoteFeedReads } from "./quote-feeds.js";
import { type AggregateCall, readAggregate } from "./read-aggregate.js";

/** Where the chain family looks for a token's pools, and what it pairs them against. */
export interface PoolPriceReaderOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
  readonly clock: Clock;
  /** Multicall3 on the chain. */
  readonly multicall: Address;
  /** A Uniswap v2-style factory, whose `getPair` finds a token's pairs. */
  readonly v2Factory?: Address;
  /** A Uniswap v3-style factory, whose `getPool` finds a token's pools at each fee tier. */
  readonly v3Factory?: Address;
  /** The v3 factory's fee tiers, in hundredths of a basis point. */
  readonly v3Fees: readonly number[];
  /**
   * The ERC-20 tokens a pool may pair the token with, each with its Chainlink feed, which values
   * a pool's depth in USD.
   */
  readonly quotes: readonly FeedAsset[];
  /** The least depth a pool must have, in micro-dollars of its quote, to price a token. */
  readonly minDepthUsdMicros: bigint;
}

/** A pool the factories know for the token. */
interface FoundPool {
  readonly kind: PoolKind;
  readonly address: Address;
  readonly quote: FeedAsset;
  readonly quoteAddress: Address;
}

/** The family's pool reads as a price reader's source. */
export const poolSource = "pools";

function addressOfToken(asset: AssetRef, chain: EvmChain): Address | undefined {
  const { chain: ref, assetNamespace, assetReference } = assetRefParts(asset);
  const address = parseEvmAddress(assetReference);
  return ref === chain.ref && assetNamespace === "erc20" && address.ok ? address.value : undefined;
}

interface Candidate {
  readonly kind: PoolKind;
  readonly quote: FeedAsset;
  readonly quoteAddress: Address;
  readonly call: AggregateCall;
}

function candidatesOf(options: PoolPriceReaderOptions, token: Address): readonly Candidate[] {
  const { v2Factory, v3Factory, v3Fees, chain } = options;
  return options.quotes.flatMap((quote) => {
    const quoteAddress = addressOfToken(quote.asset, chain);
    if (quoteAddress === undefined || quoteAddress === token) {
      return [];
    }
    const ask = (kind: PoolKind, target: Address, callData: Hex): Candidate => ({
      kind,
      quote,
      quoteAddress,
      call: { target, callData },
    });
    const v2 =
      v2Factory === undefined ? [] : [ask("v2", v2Factory, pairCallData(token, quoteAddress))];
    const v3 =
      v3Factory === undefined
        ? []
        : v3Fees.map((fee) => ask("v3", v3Factory, poolCallData(token, quoteAddress, fee)));
    return [...v2, ...v3];
  });
}

async function findPools(
  options: PoolPriceReaderOptions,
  token: Address,
  signal: AbortSignal,
): Promise<readonly FoundPool[]> {
  const candidates = candidatesOf(options, token);
  const { rpc, multicall } = options;
  const calls = candidates.map(({ call }) => call);
  const answers = await readAggregate(rpc, { multicall, calls, signal });
  return candidates.flatMap(({ kind, quote, quoteAddress }, index) => {
    const address = addressAnswer(answers[index]);
    return address === undefined || address === zeroAddress
      ? []
      : [{ kind, address, quote, quoteAddress }];
  });
}

/** A pool and its depth when measured: in base units of its quote, and in micro-dollars. */
interface DepthOf {
  readonly pool: FoundPool;
  readonly depth: bigint;
  readonly depthUsd: Ratio;
  /** The quote's price, in micro-dollars per base unit. */
  readonly quoteUsd: Ratio;
}

// Each pool's price and depth, as the per-block read reads them, with the quote feeds, at the
// latest block.
async function measure(
  options: PoolPriceReaderOptions,
  found: { readonly token: Address; readonly pools: readonly FoundPool[] },
  signal: AbortSignal,
): Promise<readonly DepthOf[]> {
  const { token, pools } = found;
  const byAsset = new Map(options.quotes.map((quote) => [quote.asset, quote]));
  const feeds = quoteFeedReads(
    byAsset,
    pools.map(({ quote }) => quote.asset),
  );
  const perPool = pools.map((pool) =>
    poolReadCalls(pool.kind).map((callData): AggregateCall => ({ target: pool.address, callData })),
  );
  const poolCalls = perPool.flat();
  const { rpc, multicall } = options;
  const answers = await readAggregate(rpc, {
    multicall,
    calls: [...poolCalls, ...feeds.calls],
    signal,
  });
  const usd = feeds.usdPrices(answers.slice(poolCalls.length), options.clock.now());
  let offset = 0;
  return pools.flatMap((pool, index) => {
    const count = perPool[index]?.length ?? 0;
    const own = answers.slice(offset, offset + count);
    offset += count;
    const state = poolState(placeOf(token, pool), own);
    const quoteUsd = usd.get(pool.quote.asset);
    if (!state.ok || quoteUsd === undefined) {
      return [];
    }
    const { depth } = state.value;
    const depthUsd = { numerator: depth * quoteUsd.numerator, denominator: quoteUsd.denominator };
    return [{ pool, depth, depthUsd, quoteUsd }];
  });
}

function isDeeper(left: Ratio, right: Ratio): boolean {
  return left.numerator * right.denominator > right.numerator * left.denominator;
}

function placeOf(token: Address, pool: FoundPool): PoolPlace {
  return { kind: pool.kind, isToken0: isToken0(token, pool.quoteAddress) };
}

// The pool must keep the least depth, and half the depth it was chosen with, or another prices the
// token (decision 0194).
function minDepthOf(options: PoolPriceReaderOptions, chosen: DepthOf): bigint {
  const { numerator, denominator } = chosen.quoteUsd;
  const half = chosen.depth / 2n;
  if (numerator <= 0n) {
    return half;
  }
  const least = (options.minDepthUsdMicros * denominator + numerator - 1n) / numerator;
  return least > half ? least : half;
}

function readOf(options: PoolPriceReaderOptions, token: Address, chosen: DepthOf): PriceRead {
  const { pool } = chosen;
  const place: PoolPlace = { ...placeOf(token, pool), minDepth: minDepthOf(options, chosen) };
  return {
    quoteAsset: pool.quote.asset,
    calls: poolReadCalls(pool.kind).map((input) => ({
      target: evmAccountRef(options.chain, pool.address),
      input,
    })),
    price: (answers) => poolPrice(place, answers),
    depthUsdMicros: chosen.depthUsd.numerator / chosen.depthUsd.denominator,
  };
}

/**
 * The chain family's own price reads for tokens that trade in Uniswap-style pools, for the price
 * watcher when no venue declares one. It asks the v2 factory for the token's pair with each quote
 * token, and the v3 factory for its pool at each fee tier, then reads every pool's price and depth
 * as the per-block read does, a v2 pair's reserves and a v3 pool's `slot0` and liquidity in range,
 * with the quote tokens' Chainlink feeds: two Multicall3 calls in all, at the latest block. It
 * prices the token from the deepest pool by the USD value of the quote it can trade, never by a
 * balance a deposit would inflate, at least `minDepthUsdMicros`. Its read measures the pool again
 * at every block, and answers `replan` once the pool is under that least depth or under half the
 * depth it was chosen with (decision 0194). A token with no such pool, or that is no ERC-20 token of the chain, is `no_price_read`.
 * Rejects when no endpoint answers, and with the signal's reason once it aborts.
 */
export function createPoolPriceReader(options: PoolPriceReaderOptions): PriceReader {
  const minDepth: Ratio = { numerator: options.minDepthUsdMicros, denominator: 1n };
  return {
    async priceRead(request, { signal }) {
      signal.throwIfAborted();
      const token = addressOfToken(request.token, options.chain);
      if (token === undefined) {
        return err("no_price_read");
      }
      const pools = await findPools(options, token, signal);
      const measured = pools.length === 0 ? [] : await measure(options, { token, pools }, signal);
      const deepest = measured.reduce<DepthOf | undefined>(
        (best, item) =>
          best === undefined || isDeeper(item.depthUsd, best.depthUsd) ? item : best,
        undefined,
      );
      return deepest === undefined || isDeeper(minDepth, deepest.depthUsd)
        ? err("no_price_read")
        : ok(readOf(options, token, deepest));
    },
  };
}
