import type { Amount } from "../amount.js";

/** What one simulation runs with. */
export interface SimulationOptions {
  readonly signal: AbortSignal;
  /**
   * What the drafts' sender holds for this run instead of its balances on the chain, one amount
   * per asset, such as a paper portfolio's balances. The native coin's balance is set exactly. A
   * token's is set where the family finds where the token keeps balances. A token whose balance it
   * cannot set, such as one that computes its balances, is a `chain.balance_unset` fault that
   * names the asset, and nothing runs.
   */
  readonly balances?: readonly Amount[];
}
