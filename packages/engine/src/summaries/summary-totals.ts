import { BinferenceError } from "@binference/core";
import type { WalletRecord } from "../install/install-record.js";
import { type LiveHoldingsOptions, liveHoldingsOf } from "../operations/live-holdings.js";
import {
  paperHoldingsOf,
  portfolioViewOf,
  type WalletHoldings,
} from "../operations/portfolio-view.js";

/** What an agent's holdings are read through, as `portfolio/get` reads them. */
export type HoldingsParts = LiveHoldingsOptions;

/** An agent's live and paper totals now, never added together. */
export interface HoldingsTotals {
  /** Absent when a live balance could not be read now. */
  readonly live?: bigint;
  readonly paper: bigint;
}

interface Read {
  readonly signal: AbortSignal;
}

// The live holdings of the wallets, or none when a chain cannot be read now.
async function liveOf(
  parts: HoldingsParts,
  wallets: readonly WalletRecord[],
  call: Read,
): Promise<readonly WalletHoldings[] | undefined> {
  try {
    return await Promise.all(wallets.map(async (wallet) => liveHoldingsOf(parts, wallet, call)));
  } catch (error) {
    call.signal.throwIfAborted();
    if (error instanceof BinferenceError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The totals in micro-dollars of what the agent's wallets not archived hold now, as `portfolio/get`
 * adds them up: live balances read on the chain, paper ones from the paper positions, each valued
 * at the price source's price, an asset without a price left out.
 */
export async function totalsOf(
  parts: HoldingsParts,
  wallets: readonly WalletRecord[],
  call: Read,
): Promise<HoldingsTotals> {
  const held = wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const [live, paper] = await Promise.all([
    liveOf(parts, held, call),
    Promise.all(
      held.map(async (wallet) =>
        paperHoldingsOf(
          wallet.id,
          await parts.positions.value({ walletId: wallet.id, isPaper: true }, call),
        ),
      ),
    ),
  ]);
  const view = portfolioViewOf([...(live ?? []), ...paper], parts.chains);
  const paperTotal = view.paperTotalUsdMicros ?? 0n;
  return live === undefined
    ? { paper: paperTotal }
    : { live: view.totalUsdMicros, paper: paperTotal };
}
