import type { AssetRef, PriceFailure, PriceSource, UsdPrice } from "@binference/chain";
import {
  BinferenceError,
  bpsPerWhole,
  type Clock,
  createDeadline,
  err,
  ok,
  type Result,
} from "@binference/core";
import {
  type Address,
  decodeAbiParameters,
  encodeFunctionData,
  type Hex,
  multicall3Abi,
  toFunctionSelector,
} from "viem";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { readAggregate } from "../watching/read-aggregate.js";
import { feedRoundSchema, latestRoundDataCall } from "./feed-round.schema.js";
import { isRoundStale, staleMarginSeconds } from "./price-from-round.js";
import type { RateAsset } from "./rate-assets.js";

/** What {@link createRatePrices} reads the rates with. */
export interface RatePricesOptions {
  /** The failover over the RPC endpoints of the chain the converting contracts are on. */
  readonly rpc: RpcFailover;
  /** Multicall3 on that chain, which reads the block's time, the pause, the rate and its feed. */
  readonly multicall: Address;
  /** The clock the read's time limit, the block's age and the feed's age run on. */
  readonly clock: Clock;
  /** How long one rate read may take in all, both requests and every endpoint asked. */
  readonly timeoutMs: number;
  /** The prices of every other asset, the chain's coin among them. */
  readonly prices: PriceSource;
  /** The assets a rate prices, each once. */
  readonly assets: readonly RateAsset[];
}

const pausedCall: Hex = toFunctionSelector("function paused()");
const blockTimeCall: Hex = encodeFunctionData({
  abi: multicall3Abi,
  functionName: "getCurrentBlockTimestamp",
});
// One 32-byte word: a longer or shorter answer is not the function's.
const wordLength = 2 + 64;
// A rate read serves every ask for a few blocks, so a portfolio or a recheck reads it once.
const keepMs = 3_000;

interface KeptRate {
  readonly rate: bigint;
  readonly untilMs: number;
}

function byAsset(assets: readonly RateAsset[]): ReadonlyMap<AssetRef, RateAsset> {
  const priced = new Map(assets.map((item) => [item.asset, item]));
  if (priced.size !== assets.length) {
    throw new BinferenceError({
      code: "chain.bad_price_feeds",
      message: "Each asset takes its price from one rate.",
      details: { assets: assets.length },
    });
  }
  return priced;
}

// `paused()`'s answer, or none for one that is not a single boolean word.
function pausedOf(data: Hex | undefined): boolean | undefined {
  try {
    return data?.length === wordLength
      ? decodeAbiParameters([{ type: "bool" }], data)[0]
      : undefined;
  } catch {
    return undefined;
  }
}

// A number's answer, or none for one that is not a single word.
function wordOf(data: Hex | undefined): bigint | undefined {
  return data?.length === wordLength
    ? decodeAbiParameters([{ type: "uint256" }], data)[0]
    : undefined;
}

// Every answer of one read, all at one pinned block, the newest the failover names: the block's
// time, the pause, the rate and the feed's round. A node that does not answer, a whole batch
// that fails, a read past its time limit and any other fault are no answers, so the token has no
// price; only the caller's own abort rejects.
async function readAnswers(
  options: RatePricesOptions,
  item: RateAsset,
  signal: AbortSignal,
): Promise<readonly (Hex | undefined)[] | undefined> {
  const { rpc, multicall, clock, timeoutMs } = options;
  const deadline = createDeadline({ clock, signal, timeoutMs });
  try {
    const block = await requestResult(rpc, {
      method: "eth_blockNumber",
      params: [],
      result: quantitySchema,
      signal: deadline.signal,
    });
    return await readAggregate(rpc, {
      multicall,
      calls: [
        { target: multicall, callData: blockTimeCall },
        { target: item.converter, callData: pausedCall },
        { target: item.converter, callData: item.convertCall },
        { target: item.checkFeed.address, callData: latestRoundDataCall },
      ],
      block,
      atHead: true,
      signal: deadline.signal,
    });
  } catch {
    signal.throwIfAborted();
    return undefined;
  } finally {
    deadline.clear();
  }
}

// One whole token converts to `rate` coin base units, which must lie within the bounds' share of
// one whole coin. Both sides are exact: no rounding moves a rate across a bound.
function isWithinBounds(item: RateAsset, rate: bigint): boolean {
  const scaled = rate * BigInt(bpsPerWhole);
  return (
    scaled >= BigInt(item.minRateBps) * item.coinUnit &&
    scaled <= BigInt(item.maxRateBps) * item.coinUnit
  );
}

// The feed's answer when it is above zero and fresh: coin per one whole token in its decimals.
function feedAnswerOf(item: RateAsset, data: Hex | undefined, nowMs: number): bigint | undefined {
  const round = feedRoundSchema.safeParse(data);
  return round.success &&
    round.data.answer > 0n &&
    !isRoundStale(item.checkFeed.heartbeatSeconds, round.data, nowMs)
    ? round.data.answer
    : undefined;
}

// The contract's rate is within the gap of the feed's, both scaled to one unit so it is exact.
function agreesWithFeed(item: RateAsset, rate: bigint, answer: bigint): boolean {
  const fromFeed = answer * item.coinUnit;
  const fromContract = rate * item.checkFeed.feedUnit;
  const gap = fromContract > fromFeed ? fromContract - fromFeed : fromFeed - fromContract;
  return gap * BigInt(bpsPerWhole) <= BigInt(item.checkFeed.maxGapBps) * fromFeed;
}

// The block is no older than a feed's margin by the clock, so a node stuck behind the chain
// cannot answer from before a pause.
function isRecent(data: Hex | undefined, nowMs: number): boolean {
  const seconds = wordOf(data);
  return (
    seconds !== undefined && BigInt(nowMs) - seconds * 1_000n <= BigInt(staleMarginSeconds) * 1_000n
  );
}

// The contract's rate when every check holds: a recent block, not paused, within its bounds and
// close to its feed.
function checkedRate(
  item: RateAsset,
  answers: readonly (Hex | undefined)[],
  nowMs: number,
): bigint | undefined {
  const [blockTime, paused, rateData, round] = answers;
  const rate = wordOf(rateData);
  const feedAnswer = feedAnswerOf(item, round, nowMs);
  return isRecent(blockTime, nowMs) &&
    pausedOf(paused) === false &&
    rate !== undefined &&
    feedAnswer !== undefined &&
    isWithinBounds(item, rate) &&
    agreesWithFeed(item, rate, feedAnswer)
    ? rate
    : undefined;
}

// The coin's price per base unit times the coin base units one token base unit converts to.
function priceAt(item: RateAsset, coin: UsdPrice, rate: bigint): UsdPrice {
  return { numerator: coin.numerator * rate, denominator: coin.denominator * item.unit };
}

/**
 * The `PriceSource` of tokens that redeem for a growing amount of their chain's coin (decision
 * 0328), over `prices` for every other asset. Such a token is worth the coin's price from `prices`
 * times what its converting contract answers for one whole token: an exact ratio of micro-dollars
 * per base unit over the contract's own answer, so only the caller rounds. The rate is read in one
 * Multicall3 call at the block the failover names newest, within `timeoutMs`, with the block's
 * time, `paused()` and the token's Chainlink rate feed, and kept for 3 seconds. The token has no
 * price, `price_refused`, which no quote overrides, when the coin has none, the block is older
 * than 30 seconds, the contract is paused, the rate is outside its bounds (zero among them) or
 * further from a fresh feed than its gap, an answer is malformed or reverted, or the read fails or
 * runs out of time. Rejects with the signal's reason once the signal aborts.
 */
export function createRatePrices(options: RatePricesOptions): PriceSource {
  const priced = byAsset(options.assets);
  const kept = new Map<AssetRef, KeptRate>();

  async function rateOf(item: RateAsset, signal: AbortSignal): Promise<bigint | undefined> {
    const nowMs = options.clock.now();
    const last = kept.get(item.asset);
    if (last !== undefined && last.untilMs > nowMs) {
      return last.rate;
    }
    const answers = await readAnswers(options, item, signal);
    const rate = answers === undefined ? undefined : checkedRate(item, answers, nowMs);
    if (rate !== undefined) {
      kept.set(item.asset, { rate, untilMs: nowMs + keepMs });
    }
    return rate;
  }

  async function ratePrice(
    item: RateAsset,
    signal: AbortSignal,
  ): Promise<Result<UsdPrice, PriceFailure>> {
    const coin = await options.prices.usdPrice(item.coin, { signal });
    const rate = coin.ok ? await rateOf(item, signal) : undefined;
    return coin.ok && rate !== undefined
      ? ok(priceAt(item, coin.value, rate))
      : err("price_refused");
  }

  return {
    async usdPrice(asset, { signal }) {
      signal.throwIfAborted();
      const item = priced.get(asset);
      return item === undefined
        ? options.prices.usdPrice(asset, { signal })
        : ratePrice(item, signal);
    },
  };
}
