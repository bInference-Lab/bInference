import { BinferenceError } from "@binference/core";
import type { WalletRecord } from "../install/install-record.js";
import {
  paperHoldingsOf,
  portfolioViewOf,
  type WalletHoldings,
} from "../operations/portfolio-view.js";
import {
  type HoldingsReadParts,
  type ReadHoldings,
  readHoldings,
} from "../operations/read-holdings.js";

/** What an agent's holdings are read through, as `portfolio/get` reads them. */
export type HoldingsParts = HoldingsReadParts;

/** An agent's live and paper totals now, never added together. */
export interface HoldingsTotals {
  /** Absent when a live balance could not be read now. */
  readonly live?: bigint;
  readonly paper: bigint;
}

interface Read {
  readonly signal: AbortSignal;
}

// What the wallets hold, or none when a chain cannot be read now.
async function heldOf(
  parts: HoldingsParts,
  wallets: readonly WalletRecord[],
  call: Read,
): Promise<ReadHoldings | undefined> {
  try {
    return await readHoldings(parts, wallets, call);
  } catch (error) {
    call.signal.throwIfAborted();
    if (error instanceof BinferenceError) {
      return undefined;
    }
    throw error;
  }
}

// The paper holdings alone, valued at the price source's prices, for a read that failed.
async function paperOf(
  parts: HoldingsParts,
  wallets: readonly WalletRecord[],
  call: Read,
): Promise<readonly WalletHoldings[]> {
  return Promise.all(
    wallets.map(async (wallet) =>
      paperHoldingsOf(
        wallet.id,
        await parts.positions.value({ walletId: wallet.id, isPaper: true }, call),
      ),
    ),
  );
}

/**
 * The totals in micro-dollars of what the agent's wallets not archived hold now, as `portfolio/get`
 * adds them up (decision 0329): live balances read on the chain, paper ones from the paper
 * positions, receipt tokens at their pool, unbonding coin and bridges in transit, an asset without
 * a price left out. When a chain cannot be read, the live total is absent and the paper one
 * counts the paper balances alone.
 */
export async function totalsOf(
  parts: HoldingsParts,
  wallets: readonly WalletRecord[],
  call: Read,
): Promise<HoldingsTotals> {
  const held = wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const read = await heldOf(parts, held, call);
  if (read === undefined) {
    const view = portfolioViewOf(await paperOf(parts, held, call), parts.chains);
    return { paper: view.paperTotalUsdMicros ?? 0n };
  }
  const view = portfolioViewOf(read.holdings, parts.chains, read.elsewhere);
  return { live: view.totalUsdMicros, paper: view.paperTotalUsdMicros ?? 0n };
}
