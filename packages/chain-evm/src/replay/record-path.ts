import { bpsPerWhole } from "@binference/core";
import { decodeEventLog, type Hex, parseAbi, toEventSelector } from "viem";
import type { PathBlock } from "./price-path.js";

const syncAbi = parseAbi(["event Sync(uint112 reserve0, uint112 reserve1)"]);

/** The topic of a Uniswap v2 pair's `Sync` event, which every trade and deposit emits. */
export const syncTopic: Hex = toEventSelector("Sync(uint112,uint112)");

/** A pair's reserves after one `Sync`, where in the chain it came. */
export interface PairSync {
  readonly block: bigint;
  readonly logIndex: bigint;
  readonly reserve0: bigint;
  readonly reserve1: bigint;
}

/** Reads a `Sync` log's reserves; throws on a log of another event. */
export function syncReserves(log: {
  readonly topics: readonly Hex[];
  readonly data: Hex;
}): Pick<PairSync, "reserve0" | "reserve1"> {
  const [topic, ...rest] = log.topics;
  if (topic === undefined) {
    throw new Error("A Sync log has a topic.");
  }
  const decoded = decodeEventLog({
    abi: syncAbi,
    eventName: "Sync",
    topics: [topic, ...rest],
    data: log.data,
    strict: true,
  });
  return decoded.args;
}

/** How one pair's syncs become its recorded blocks. */
export interface PathShape {
  /** The day's first block: offsets count from it. */
  readonly firstBlock: bigint;
  /** Whether the token is the pair's `token0`. */
  readonly isToken0: boolean;
  readonly tokenDecimals: number;
  readonly quoteDecimals: number;
  /** A block is kept when its price moved at least this far from the last block kept. */
  readonly minMoveBps: number;
}

const priceDigits = 18;

/** Whole quote tokens per whole token, cut (not rounded) to 18 places. */
export function pathPrice(
  reserves: { readonly reserveToken: bigint; readonly reserveQuote: bigint },
  shape: Pick<PathShape, "tokenDecimals" | "quoteDecimals">,
): string {
  const scale = 10n ** BigInt(priceDigits);
  const numerator = reserves.reserveQuote * 10n ** BigInt(shape.tokenDecimals) * scale;
  const denominator = reserves.reserveToken * 10n ** BigInt(shape.quoteDecimals);
  const scaled = numerator / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(priceDigits, "0");
  return `${whole.toString()}.${fraction}`;
}

/**
 * Whether a pair's price, quote per token, moved at least `bps` from `before` to `now`, compared
 * exactly on the reserves.
 */
export function movedFrom(
  before: Pick<PathBlock, "reserveToken" | "reserveQuote">,
  now: Pick<PathBlock, "reserveToken" | "reserveQuote">,
  bps: number,
): boolean {
  const priceNow = now.reserveQuote * before.reserveToken;
  const priceBefore = before.reserveQuote * now.reserveToken;
  const move = priceNow > priceBefore ? priceNow - priceBefore : priceBefore - priceNow;
  return move * BigInt(bpsPerWhole) >= priceBefore * BigInt(bps);
}

// Each block's last sync: a block's price is its state after its last trade.
function lastOfEachBlock(syncs: readonly PairSync[]): readonly PairSync[] {
  const byBlock = new Map<bigint, PairSync>();
  for (const sync of syncs) {
    const kept = byBlock.get(sync.block);
    if (kept === undefined || sync.logIndex > kept.logIndex) {
      byBlock.set(sync.block, sync);
    }
  }
  return [...byBlock.values()].toSorted((a, b) => (a.block < b.block ? -1 : 1));
}

/**
 * One pair's recorded blocks from its `Sync` logs over a day: the reserves after each block's
 * last trade, kept when the price moved at least `minMoveBps` from the last block kept. The first
 * and the last block are always kept, so the path starts and ends where the day did. A sync with
 * an empty side, which no price comes from, is left out.
 */
export function recordedBlocks(syncs: readonly PairSync[], shape: PathShape): readonly PathBlock[] {
  const blocks = lastOfEachBlock(syncs)
    .filter(({ reserve0, reserve1 }) => reserve0 > 0n && reserve1 > 0n)
    .map((sync): PathBlock => {
      const reserveToken = shape.isToken0 ? sync.reserve0 : sync.reserve1;
      const reserveQuote = shape.isToken0 ? sync.reserve1 : sync.reserve0;
      const price = pathPrice({ reserveToken, reserveQuote }, shape);
      return { offset: sync.block - shape.firstBlock, reserveToken, reserveQuote, price };
    });
  const kept: PathBlock[] = [];
  blocks.forEach((block, index) => {
    const last = kept.at(-1);
    const isLast = index === blocks.length - 1;
    if (last === undefined || isLast || movedFrom(last, block, shape.minMoveBps)) {
      kept.push(block);
    }
  });
  return kept;
}
