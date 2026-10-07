import { BinferenceError, type Id } from "@binference/core";
import { applyArrival } from "./apply-arrival.js";
import type { ArrivalDraft, PaperReset } from "./arrival-record.js";
import { emptyCostBasis } from "./average-cost.js";
import { positionWriteOf } from "./position-change.js";
import type { PositionRecord, PositionWrite } from "./position-record.js";

/** What a wallet's paper reset is computed from. */
export interface PaperResetInput {
  readonly walletId: Id<"wal">;
  readonly atMs: number;
  /** The wallet's paper positions as read; each write names the version it read. */
  readonly held: readonly PositionRecord[];
  /** The starting balances, each a valued paper arrival of the wallet at `atMs`. */
  readonly arrivals: readonly ArrivalDraft[];
}

function assertDistinct(input: PaperResetInput): void {
  const assets = new Set(input.arrivals.map((arrival) => arrival.received.asset));
  if (assets.size < input.arrivals.length) {
    throw new BinferenceError({
      code: "positions.bad_reset",
      message: "A paper reset starts each asset once.",
      details: { wallet: input.walletId },
    });
  }
}

/**
 * A wallet's paper reset: every paper position it holds emptied, realized profit or loss
 * included, then each starting balance opened at its value as an arrival (decision 0058). An asset
 * the wallet held and starts again with is written once, from its emptied row. Throws
 * `positions.bad_reset` when two starting balances name one asset.
 */
export function paperResetOf(input: PaperResetInput): PaperReset {
  assertDistinct(input);
  const { walletId, atMs } = input;
  const emptied = input.held.map((record) => ({ ...record, ...emptyCostBasis }));
  const opened = input.arrivals.flatMap((arrival) => applyArrival(emptied, arrival));
  const openedAssets = new Set(opened.map((write) => write.position.asset));
  const move = { walletId, isPaper: true, atMs };
  const cleared: readonly PositionWrite[] = input.held
    .filter((record) => !openedAssets.has(record.asset))
    .map((record) =>
      positionWriteOf(move, { asset: record.asset, basis: emptyCostBasis, held: record }),
    );
  return { walletId, arrivals: input.arrivals, positions: [...cleared, ...opened] };
}
