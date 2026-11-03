import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";

/** Value a step moved from one account to another: the native coin or a token. */
export interface AssetTransfer {
  readonly from: AccountRef;
  readonly to: AccountRef;
  readonly amount: Amount;
}

/** A token allowance a step set: `spender` may now spend up to `amount` of `owner`'s tokens. */
export interface AssetApproval {
  readonly owner: AccountRef;
  readonly spender: AccountRef;
  readonly amount: Amount;
}

/**
 * One log a step emitted, in its chain family's own encoding: the contract that emitted it, its
 * topics and its data, as the family writes them. Only code that knows the family reads it.
 */
interface StepLog {
  readonly emitter: AccountRef;
  readonly topics: readonly string[];
  readonly data: string;
}

/** What one transaction draft did when it ran on its chain's latest state, unsent. */
export interface SimulatedStep {
  readonly status: "success" | "reverted";
  /**
   * The work the step used, in its family's own unit: gas on an EVM chain. The fee it costs is
   * never among the transfers, so a caller counts it apart from them.
   */
  readonly gasUsed: bigint;
  /** The native coin and token transfers it made, in order; none when it reverted. */
  readonly transfers: readonly AssetTransfer[];
  /** The token allowances it set, in order; none when it reverted. */
  readonly approvals: readonly AssetApproval[];
  /**
   * Every log it emitted, in order, for effects the transfers leave out, such as a token of a
   * collection minted to the wallet; none when it reverted, and absent from a simulator that
   * reports no logs.
   */
  readonly logs?: readonly StepLog[];
}
