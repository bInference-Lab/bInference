import type { AccountRef, AssetRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { PastOutflow } from "../policy/policy-rules.js";

/** Which wallet's facts to read, for an intent in which mode. */
export interface WalletFactsQuery {
  readonly agent: Id<"agt">;
  readonly wallet: Id<"wal">;
  /** The wallet's account on the intent's chain. */
  readonly account: AccountRef;
  /** The intent runs on paper: its balance is the paper portfolio's. */
  readonly isPaper: boolean;
  /**
   * The intent the facts are read for once it is confirmed, as the wallet queue checks it again:
   * its own outflow is left out of `recentOutflows`, so the policy does not count it twice.
   */
  readonly intent?: Id<"int">;
}

/**
 * What the policy and the auto test read about one wallet now, beyond the agent's limits. Every
 * amount is in base units of the chain's native coin.
 */
export interface WalletFacts {
  /** The wallet's native balance: the paper balance for a paper intent. */
  readonly nativeBalanceBase: bigint;
  /** The ceiling's native value cap per transaction (spec 5, section 4). */
  readonly ceilingPerTxNativeBase: bigint;
  /** The most fee per gas a transaction pays now on the account's chain. */
  readonly feePerGasNativeBase: bigint;
  /** The chain's network fee cap (decision 0102). */
  readonly networkFeeCapNativeBase: bigint;
  /**
   * The agent's outflows confirmed in the last 24 hours, in the intent's mode, each at the value
   * the policy judged it at (decision 0136).
   */
  readonly recentOutflows: readonly PastOutflow[];
}

/** Which live balances to read: one account's, of each asset, on the account's chain. */
export interface BalancesQuery {
  readonly account: AccountRef;
  readonly assets: readonly AssetRef[];
}
