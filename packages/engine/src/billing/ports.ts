import type { BudgetNoticeClaim, ModelCharge, ModelSpend, SpendQuery } from "./model-charge.js";

/** What every store call takes. A call on an aborted signal rejects with the signal's reason. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps each model call attempt an agent's runtime recorded (database spec, `model_usage`), and
 * the day each agent's owner was told its model budget is spent (`budget_notices`). Adapters:
 * `model_usage` in engine.sqlite, and a fake.
 */
export interface ModelUsageStore {
  /**
   * Stores an attempt under its key and answers `recorded`; a key stored before answers `exists`
   * and changes nothing. An agent the store does not hold fails with `store.constraint`.
   */
  record(charge: ModelCharge, options: StoreCall): Promise<"recorded" | "exists">;
  /**
   * What each agent spent on each model from `fromMs` up to, not including, `toMs`, by agent and
   * then model; a model with no attempt in the range is left out.
   */
  spent(query: SpendQuery, options: StoreCall): Promise<readonly ModelSpend[]>;
  /**
   * Claims the notice that the agent's budget of the day is spent: `true` the first time for that
   * agent and day, `false` after, so the owner is told once a day.
   */
  claimBudgetNotice(claim: BudgetNoticeClaim, options: StoreCall): Promise<boolean>;
}
