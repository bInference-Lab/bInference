import type { Address } from "viem";

/** One block of a pair's recorded day: its reserves after the block's last trade. */
export interface PathBlock {
  /** Blocks after the day's first block. */
  readonly offset: bigint;
  /** Base units of the token the pair held. */
  readonly reserveToken: bigint;
  /** Base units of the quote token the pair held. */
  readonly reserveQuote: bigint;
  /** Whole quote tokens for one whole token, cut to 18 places: the reserves' price, for reading. */
  readonly price: string;
}

/** One PancakeSwap v2 pair's recorded day. */
export interface PoolPath {
  readonly symbol: string;
  readonly token: Address;
  readonly quote: Address;
  readonly pair: Address;
  readonly tokenDecimals: number;
  readonly quoteDecimals: number;
  /** The blocks whose last trade moved the price, oldest first; the first and last always. */
  readonly blocks: readonly PathBlock[];
}

/** A recorded day of prices: each pair's reserves block by block. */
export interface PricePath {
  /** The UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The chain's first block of the day, and its last. */
  readonly firstBlock: bigint;
  readonly lastBlock: bigint;
  /** A block is kept when its price moved at least this far from the last block kept. */
  readonly minMoveBps: number;
  readonly pools: readonly PoolPath[];
}

/**
 * A recorded day as its JSON file keeps it: amounts as decimal strings, each block a row of
 * `[offset, reserveToken, reserveQuote, price]`, so the file stays small and diffs by block.
 */
export function writePricePath(path: PricePath): string {
  const file = {
    day: path.day,
    firstBlock: path.firstBlock.toString(),
    lastBlock: path.lastBlock.toString(),
    minMoveBps: path.minMoveBps,
    pools: path.pools.map((pool) => ({
      symbol: pool.symbol,
      token: pool.token,
      quote: pool.quote,
      pair: pool.pair,
      tokenDecimals: pool.tokenDecimals,
      quoteDecimals: pool.quoteDecimals,
      blocks: pool.blocks.map(({ offset, reserveToken, reserveQuote, price }) => [
        offset.toString(),
        reserveToken.toString(),
        reserveQuote.toString(),
        price,
      ]),
    })),
  };
  return `${JSON.stringify(file, undefined, 2)}\n`;
}
