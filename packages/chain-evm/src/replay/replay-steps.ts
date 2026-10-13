import type { Ratio } from "@binference/core";
import type { PathBlock, PricePath } from "./price-path.js";
import { movedFrom } from "./record-path.js";

/** One pool's move in a replayed block: to its recorded price, as a share of its first one. */
export interface ReplayMove {
  /** The pool's index in the recorded day. */
  readonly pool: number;
  /** The recorded price over the pool's first recorded price, exact. */
  readonly scale: Ratio;
}

/** One block of a replay: the recorded block it replays and the pools it moves. */
export interface ReplayStep {
  /** The recorded block's offset in its day. */
  readonly offset: bigint;
  readonly moves: readonly ReplayMove[];
}

// The price of `block` over the price of `first`, quote per token both: (q/t) / (q0/t0).
function scaleOf(first: PathBlock, block: PathBlock): Ratio {
  return {
    numerator: block.reserveQuote * first.reserveToken,
    denominator: block.reserveToken * first.reserveQuote,
  };
}

// Recorded blocks in the chain's order, and the pools of one block in the day's order.
function byBlockThenPool(
  a: { readonly pool: number; readonly block: PathBlock },
  b: { readonly pool: number; readonly block: PathBlock },
): number {
  if (a.block.offset !== b.block.offset) {
    return a.block.offset < b.block.offset ? -1 : 1;
  }
  return a.pool - b.pool;
}

/**
 * The blocks a replay mines for a recorded day, with the quiet stretches compressed: a recorded
 * block is replayed when one of its pools moved at least `stepBps` from the price that pool was
 * last replayed at, and all the pools it moves move in one replayed block. The blocks between
 * are left out, so a replayed pool never stands more than `stepBps` from its recorded price, and
 * an hour with no such move costs no block. Each pool starts at its first recorded price.
 */
export function replaySteps(path: PricePath, stepBps: number): readonly ReplayStep[] {
  const last = path.pools.map((pool) => pool.blocks[0]);
  const byOffset = new Map<bigint, ReplayMove[]>();
  const blocks = path.pools.flatMap((pool, index) =>
    pool.blocks.slice(1).map((block) => ({ pool: index, block })),
  );
  blocks.sort(byBlockThenPool);
  for (const { pool, block } of blocks) {
    const before = last[pool];
    const first = path.pools[pool]?.blocks[0];
    if (before !== undefined && first !== undefined && movedFrom(before, block, stepBps)) {
      last[pool] = block;
      const moves = byOffset.get(block.offset) ?? [];
      moves.push({ pool, scale: scaleOf(first, block) });
      byOffset.set(block.offset, moves);
    }
  }
  return [...byOffset].map(([offset, moves]) => ({ offset, moves }));
}
