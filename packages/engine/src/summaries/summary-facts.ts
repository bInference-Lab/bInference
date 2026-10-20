import type { FillCounts } from "../orders/fill-counts.js";

/** One mode's figures: its holdings' total now and the trades of the last 24 hours. */
export interface ModeFigures {
  /** The total in micro-dollars; absent when the balances could not be read now. */
  readonly totalUsdMicros?: bigint;
  /** What the trades of the last 24 hours realized, at average cost. */
  readonly realizedUsdMicros: bigint;
  readonly trades: number;
}

/** What waits for the owner now. */
interface OwnerWaits {
  /** Cards waiting for a tap. */
  readonly cards: number;
  /** Whether the agent's question waits for an answer. */
  readonly question: boolean;
  /** Looser limits that take effect later. */
  readonly limits: number;
  /** Wallets a stuck step holds. */
  readonly heldWallets: number;
}

/** What one agent's daily summary tells: its last 24 hours, and what stands open now. */
export interface SummaryFacts {
  readonly live: ModeFigures;
  readonly paper: ModeFigures;
  readonly fills: FillCounts;
  /** Active and paused auto orders. */
  readonly openOrders: number;
  readonly spendUsdMicros: bigint;
  readonly budgetUsdMicros: bigint;
  readonly waits: OwnerWaits;
}
