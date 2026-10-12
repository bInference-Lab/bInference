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
  balanceCallData,
  liquidityCall,
  numberAnswer,
  pairCallData,
  poolCallData,
  type PoolKind,
  poolPrice,
  reservesCall,
  slot0Call,
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
  /** The least a pool must hold of its quote token, in micro-dollars, to price a token. */
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

/** A pool and its depth: the quote token it holds, in micro-dollars. */
interface DepthOf {
  readonly pool: FoundPool;
  readonly depth: Ratio;
}

// Each pool's quote balance and, for a v3 pool, its liquidity in range, with the quote feeds, at
// the latest block. A v3 pool with no liquidity in range quotes a price nobody can trade at.
async function measure(
  options: PoolPriceReaderOptions,
  pools: readonly FoundPool[],
  signal: AbortSignal,
): Promise<readonly DepthOf[]> {
  const byAsset = new Map(options.quotes.map((quote) => [quote.asset, quote]));
  const feeds = quoteFeedReads(
    byAsset,
    pools.map(({ quote }) => quote.asset),
  );
  const poolCalls = pools.flatMap((pool): AggregateCall[] => [
    {
      target: pool.quoteAddress,
      callData: balanceCallData(pool.address),
    },
    { target: pool.address, callData: pool.kind === "v3" ? liquidityCall : reservesCall },
  ]);
  const { rpc, multicall } = options;
  const calls = [...poolCalls, ...feeds.calls];
  const answers = await readAggregate(rpc, { multicall, calls, signal });
  const usd = feeds.usdPrices(answers.slice(poolCalls.length), options.clock.now());
  return pools.flatMap((pool, index) => {
    const held = numberAnswer(answers[index * 2]);
    const price = usd.get(pool.quote.asset);
    // A v2 pair answers its reserves, which `numberAnswer` refuses; a v3 pool, its liquidity.
    const state = answers[index * 2 + 1];
    const isLive = pool.kind === "v2" ? state !== undefined : (numberAnswer(state) ?? 0n) > 0n;
    if (held === undefined || price === undefined || !isLive) {
      return [];
    }
    return [{ pool, depth: { numerator: held * price.numerator, denominator: price.denominator } }];
  });
}

function isDeeper(left: Ratio, right: Ratio): boolean {
  return left.numerator * right.denominator > right.numerator * left.denominator;
}

function readOf(options: PoolPriceReaderOptions, token: Address, pool: FoundPool): PriceRead {
  const place = { kind: pool.kind, isToken0: isToken0(token, pool.quoteAddress) };
  return {
    quoteAsset: pool.quote.asset,
    calls: [
      {
        target: evmAccountRef(options.chain, pool.address),
        input: pool.kind === "v2" ? reservesCall : slot0Call,
      },
    ],
    price: (answers) => poolPrice(place, answers),
  };
}

/**
 * The chain family's own price reads for tokens that trade in Uniswap-style pools, for the price
 * watcher when no venue declares one. It asks the v2 factory for the token's pair with each quote
 * token, and the v3 factory for its pool at each fee tier, then reads every pool's quote balance,
 * each v3 pool's liquidity in range and the quote tokens' Chainlink feeds, two Multicall3 calls in
 * all, at the latest block. It prices the token from the deepest pool by the USD value of the quote
 * token it holds, at least `minDepthUsdMicros`: a v2 pair by its reserves, a v3 pool by its current
 * price. A token with no such pool, or that is no ERC-20 token of the chain, is `no_price_read`.
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
      const measured = pools.length === 0 ? [] : await measure(options, pools, signal);
      const deepest = measured.reduce<DepthOf | undefined>(
        (best, item) => (best === undefined || isDeeper(item.depth, best.depth) ? item : best),
        undefined,
      );
      return deepest === undefined || isDeeper(minDepth, deepest.depth)
        ? err("no_price_read")
        : ok(readOf(options, token, deepest.pool));
    },
  };
}
