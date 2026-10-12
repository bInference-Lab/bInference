import { BinferenceError, type Clock } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import type { AgentSettings } from "../agents/agent-record.js";
import type { ModelBilling } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { ownerDayOf } from "./daily-model-budget.js";
import type { ModelCharge } from "./model-charge.js";
import type { ModelUsageStore } from "./ports.js";

/** The owner's notice that an agent's model budget of the day is spent (spec 4, section 4). */
const budgetNoticeKey = "notice.budget";

// Dollars read the same in every language (`$3.00`), so the notice carries them as text.
const dollars = createFormatter({ locale: "en", timeZone: "UTC" });

/** What the engine needs for each agent's model budget besides its stores. */
export interface ModelBudgetParts {
  /** `owner.timezone` now: the owner's day, midnight to midnight, each model budget runs over. */
  readonly ownerTimeZone: () => string;
  /**
   * Who pays for model calls and what each agent may still spend; the daily model budget over the
   * stored usage when left out.
   */
  readonly billing?: ModelBilling;
}

/** What the model budget charges through, reads and tells the owner through. */
export interface ModelBudgetOptions {
  readonly billing: ModelBilling;
  readonly usage: ModelUsageStore;
  /** `owner.timezone`, read at each call: the budget resumes at the owner's next midnight. */
  readonly timeZone: () => string;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

/** What is left of an agent's model budget after a charge, and when a spent one resumes. */
interface BudgetLeft {
  readonly leftMicros: bigint;
  /** The owner's next midnight, once nothing is left. */
  readonly resumesAt?: number;
}

/**
 * Each agent's daily model budget as chat meets it (runtime spec, section 8.3): a turn starts only
 * while some of it is left, each model call attempt is charged once by its key, and the owner is
 * told once a day per agent when it is spent. Orders, watchers and alerts never ask it.
 */
export interface ModelBudget {
  /**
   * What is left for the agent's next turn. Once nothing is left it tells the owner, at most once
   * that day, and throws `agent.budget` with `details.resumesAt`, the owner's next midnight.
   */
  open(settings: AgentSettings, options: { readonly signal: AbortSignal }): Promise<bigint>;
  /**
   * Charges one attempt of the agent's once by its key and answers what is left; once nothing is
   * left, with the owner's next midnight, and the owner is told at most once that day.
   */
  charge(
    settings: AgentSettings,
    charge: ModelCharge,
    options: { readonly signal: AbortSignal },
  ): Promise<BudgetLeft>;
}

/** Creates the {@link ModelBudget} over the billing and the stored usage. */
export function createModelBudget(options: ModelBudgetOptions): ModelBudget {
  const { billing, usage, timeZone, clock, publish } = options;
  // Tells the owner the agent's budget of the day is spent, once that day; answers the resume.
  const spent = async (
    settings: AgentSettings,
    call: { readonly signal: AbortSignal },
  ): Promise<number> => {
    const nowMs = clock.now();
    const day = ownerDayOf(nowMs, timeZone());
    const { agent, limits } = settings;
    const claim = { agent: agent.id, dayAtMs: day.startMs, atMs: nowMs };
    if (await usage.claimBudgetNotice(claim, call)) {
      const values = { agent: agent.name, budget: dollars.usd(limits.modelBudgetUsdMicros) };
      publish(
        noticePush({ key: budgetNoticeKey, agent: agent.id, values, times: { when: day.endMs } }),
      );
    }
    return day.endMs;
  };
  return {
    async open(settings, call) {
      const left = await billing.left(settings.agent.id, call);
      if (left > 0n) {
        return left;
      }
      const resumesAt = await spent(settings, call);
      throw new BinferenceError({
        code: "agent.budget",
        message: `Agent ${settings.agent.id} used today's model budget.`,
        details: { agent: settings.agent.id, resumesAt },
      });
    },
    async charge(settings, charge, call) {
      const left = await billing.charge(charge, call);
      return left > 0n
        ? { leftMicros: left }
        : { leftMicros: 0n, resumesAt: await spent(settings, call) };
    },
  };
}
