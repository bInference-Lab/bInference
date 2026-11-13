import type { Generated } from "kysely";

/**
 * The breaker's mark of the install in `safety` (migration 0066, decision 0440), beside the
 * owner's freeze: when it took hold, the versions applied and told, and when its row turned to
 * pulled for the last hold.
 */
export interface BreakerColumns {
  breaker_at: number | null;
  breaker_version: Generated<number>;
  breaker_told: Generated<number>;
  breaker_pulled_at: number | null;
}
