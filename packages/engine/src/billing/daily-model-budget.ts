import type { Clock, Id } from "@binference/core";
import { dayStartOf, nextDayStartOf } from "@binference/i18n";
import type { AgentStore, ModelBilling } from "../ports.js";
import type { ModelUsageStore } from "./ports.js";

/** What the daily model budget reads: the stored usage, each agent's budget, and the owner's day. */
export interface DailyModelBudgetOptions {
  readonly usage: ModelUsageStore;
  /** Each agent's limits as they are in effect now: `modelBudgetUsdMicros` is its daily budget. */
  readonly agents: Pick<AgentStore, "get">;
  /** `owner.timezone`, read at each call, so a change applies from the next one. */
  readonly timeZone: () => string;
  readonly clock: Clock;
}

/** The owner's day that holds a moment: its start, and the next day's start. */
export interface OwnerDay {
  readonly startMs: number;
  readonly endMs: number;
}

/** The owner's day that holds `atMs` in `timeZone`, midnight to midnight. */
export function ownerDayOf(atMs: number, timeZone: string): OwnerDay {
  return { startMs: dayStartOf(atMs, timeZone), endMs: nextDayStartOf(atMs, timeZone) };
}

/**
 * Creates the daily model budget, a {@link ModelBilling} for an owner whose model key or Router
 * link pays the provider: each agent may spend its daily model budget (`limits.model_budget_usd_micros`,
 * default $3) over the owner's day, midnight to midnight in `owner.timezone` (ARCHITECTURE.md
 * section 26). A charge stores the attempt in `model_usage` under its key, once; what is left is
 * the budget less the day's stored spend, never below 0. An agent the store does not hold has
 * nothing to spend.
 */
export function createDailyModelBudget(options: DailyModelBudgetOptions): ModelBilling {
  const { usage, agents, timeZone, clock } = options;
  const left = async (agent: Id<"agt">, call: { readonly signal: AbortSignal }) => {
    const settings = await agents.get(agent, call);
    if (settings === undefined) {
      return 0n;
    }
    const day = ownerDayOf(clock.now(), timeZone());
    const spent = await usage.spent({ agent, fromMs: day.startMs, toMs: day.endMs }, call);
    const total = spent.reduce((sum, { usdMicros }) => sum + usdMicros, 0n);
    const budget = settings.limits.modelBudgetUsdMicros;
    return budget > total ? budget - total : 0n;
  };
  return {
    left,
    async charge(charge, call) {
      await usage.record(charge, call);
      return left(charge.agent, call);
    },
  };
}
