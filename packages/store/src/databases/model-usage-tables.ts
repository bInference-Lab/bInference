import type { Generated } from "kysely";

// The model budget's tables, as SQLite returns them: migration 0008 defines `model_usage`, and
// migration 0033 makes it again with `key` and adds `budget_notices`.

/** `model_usage`: one attempt of a model call, its tokens and its cost as decimal text. */
interface ModelUsageTable {
  id: Generated<number>;
  key: string;
  agent_id: string;
  turn_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  usd_micros: string;
  at: number;
}

/** `budget_notices`: an owner's day on which an agent's model budget was spent and told. */
interface BudgetNoticesTable {
  agent_id: string;
  day_at: number;
  at: number;
}

/** The model budget's tables, by name. */
export interface ModelUsageTables {
  model_usage: ModelUsageTable;
  budget_notices: BudgetNoticesTable;
}
