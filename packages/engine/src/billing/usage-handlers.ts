import { err, ok } from "@binference/core";
import { dayStartOf, nextDayStartOf } from "@binference/i18n";
import type { ResultOf } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { EngineCall, EngineHandler } from "../operations/engine-call.js";
import type { AgentStore, ModelBilling } from "../ports.js";
import type { ModelUsageStore } from "./ports.js";

/** The usage operation of protocol spec section 7.7 that the engine answers itself. */
export interface UsageHandlers {
  readonly "usage/get": EngineHandler<"usage/get">;
}

/** What `usage/get` reads. */
export interface UsageHandlersOptions {
  readonly billing: ModelBilling;
  readonly usage: ModelUsageStore;
  readonly agents: Pick<AgentStore, "get" | "list">;
  /** `owner.timezone`, whose days the spend is counted by. */
  readonly timeZone: () => string;
}

const dayMs = 86_400_000;
// A quarter at most: each day of the range is one read of the store.
const maxRangeMs = 92 * dayMs;

type UsageView = ResultOf<"usage/get">;

/** One owner's day of the range, cut to the range at its ends. */
interface DaySpan {
  readonly dayAt: number;
  readonly fromMs: number;
  readonly toMs: number;
}

function daysOf(fromMs: number, toMs: number, timeZone: string): readonly DaySpan[] {
  const days: DaySpan[] = [];
  for (let dayAt = dayStartOf(fromMs, timeZone); dayAt < toMs;) {
    const next = nextDayStartOf(dayAt, timeZone);
    days.push({ dayAt, fromMs: Math.max(dayAt, fromMs), toMs: Math.min(next, toMs) });
    dayAt = next;
  }
  return days;
}

// The agent the call names, or every agent that is not archived.
async function agentsOf(
  options: UsageHandlersOptions,
  call: EngineCall<"usage/get">,
): Promise<readonly AgentSettings[] | undefined> {
  const { agent } = call.args;
  if (agent !== undefined) {
    const settings = await options.agents.get(agent, call);
    return settings === undefined ? undefined : [settings];
  }
  const records = await options.agents.list(call);
  const active = records.filter((record) => record.archivedAtMs === undefined);
  const found = await Promise.all(active.map(async ({ id }) => options.agents.get(id, call)));
  return found.filter((settings) => settings !== undefined);
}

async function rowsOf(
  options: UsageHandlersOptions,
  call: EngineCall<"usage/get">,
): Promise<UsageView["rows"]> {
  const { agent: named, from, to } = call.args;
  const days = daysOf(from, to, options.timeZone());
  const spent = await Promise.all(
    days.map(async ({ dayAt, fromMs, toMs }) => {
      const query = { fromMs, toMs, ...(named === undefined ? {} : { agent: named }) };
      const sums = await options.usage.spent(query, call);
      return sums.map(({ agent, model, inputTokens, outputTokens, cachedTokens, usdMicros }) => ({
        agent,
        dayAt,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
        usdMicros,
      }));
    }),
  );
  return spent.flat();
}

/**
 * Creates `usage/get`: each agent's model spend by owner's day and model over the range, at most
 * 92 days, and each agent's daily budget with what is left of it today. With no agent named it
 * reads every agent that is not archived; an unknown agent is `agent.not_found`.
 */
export function createUsageHandlers(options: UsageHandlersOptions): UsageHandlers {
  return {
    async "usage/get"(call) {
      const { from, to } = call.args;
      if (to <= from || to - from > maxRangeMs) {
        return err("protocol.bad_args");
      }
      const agents = await agentsOf(options, call);
      if (agents === undefined) {
        return err("agent.not_found");
      }
      const rows = await rowsOf(options, call);
      const budgets = await Promise.all(
        agents.map(async ({ agent, limits }) => ({
          agent: agent.id,
          dailyUsdMicros: limits.modelBudgetUsdMicros,
          leftUsdMicros: await options.billing.left(agent.id, call),
        })),
      );
      return ok({ rows, budgets });
    },
  };
}
