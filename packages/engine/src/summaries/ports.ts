import type { Id, Result } from "@binference/core";
import type { DailySummaryRecord } from "./daily-summary-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps each agent's daily summaries (database spec, `daily_summaries`), so a summary goes out
 * once per owner's date across a restart. Adapters: `daily_summaries` in engine.sqlite, and a fake.
 */
export interface DailySummaryStore {
  /**
   * Stores the summary of an agent's date and answers it, unless the agent has one of that date or
   * a later one: `claimed`, and nothing changes. An agent the store does not hold throws
   * `store.constraint`.
   */
  claim(
    record: DailySummaryRecord,
    options: StoreCall,
  ): Promise<Result<DailySummaryRecord, "claimed">>;
  /** The agent's summary of its latest date, or `undefined` before its first. */
  latest(agent: Id<"agt">, options: StoreCall): Promise<DailySummaryRecord | undefined>;
}
