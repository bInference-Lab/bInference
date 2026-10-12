import { dayStartOf, monthStartOf, nextDayStartOf } from "@binference/i18n";
import type { ResultOf } from "@binference/protocol";
import { callOrSay, type CommandContext } from "./command-context.js";

type UsageView = ResultOf<"usage/get">;
type UsageRow = UsageView["rows"][number];
type UsageBudget = UsageView["budgets"][number];

// The models that cost the most this month, at most this many, so the reply stays short.
const topModels = 3;

function sumOf(rows: readonly UsageRow[]): bigint {
  return rows.reduce((sum, { usdMicros }) => sum + usdMicros, 0n);
}

// Each model's spend over the rows, the costliest first.
function byModel(rows: readonly UsageRow[]): readonly (readonly [string, bigint])[] {
  const sums = new Map<string, bigint>();
  for (const { model, usdMicros } of rows) {
    sums.set(model, (sums.get(model) ?? 0n) + usdMicros);
  }
  return [...sums].toSorted(([, left], [, right]) => Number(right > left) - Number(right < left));
}

/** The owner's day and month, as `/spend` counts them. */
interface SpendTimes {
  readonly todayMs: number;
  readonly resumesAt: number;
}

function agentLines(
  context: CommandContext,
  budget: UsageBudget,
  parts: { readonly rows: readonly UsageRow[]; readonly times: SpendTimes },
): readonly string[] {
  const { words, formatter } = context;
  const rows = parts.rows.filter((row) => row.agent === budget.agent);
  const today = rows.filter((row) => row.dayAt >= parts.times.todayMs);
  const models = byModel(rows).slice(0, topModels);
  return [
    words("cmd.spend.today", {
      agent: budget.agent,
      spent: formatter.usd(sumOf(today)),
      budget: formatter.usd(budget.dailyUsdMicros),
      left: formatter.usd(budget.leftUsdMicros),
    }),
    ...(budget.leftUsdMicros > 0n
      ? []
      : [words("cmd.spend.paused", { when: formatter.dateTime(parts.times.resumesAt) })]),
    words("cmd.spend.month", { spent: formatter.usd(sumOf(rows)) }),
    ...models.map(([model, spent]) =>
      words("cmd.spend.model", { model, spent: formatter.usd(spent) }),
    ),
  ];
}

/**
 * `/spend`: each agent's model spend today against its daily budget, what is left, and when chat
 * resumes once it is spent; then its spend this month and the models that cost the most, read
 * from `usage/get` over the owner's days.
 */
export async function runSpend(context: CommandContext): Promise<void> {
  const { nowMs, timeZone } = context;
  const range = { from: monthStartOf(nowMs, timeZone), to: nowMs + 1 };
  const usage = await callOrSay(context, "usage/get", range);
  if (usage === undefined) {
    return;
  }
  if (usage.budgets.length === 0) {
    await context.say(context.words("cmd.spend.none"));
    return;
  }
  const times = {
    todayMs: dayStartOf(nowMs, timeZone),
    resumesAt: nextDayStartOf(nowMs, timeZone),
  };
  const lines = usage.budgets.flatMap((budget) =>
    agentLines(context, budget, { rows: usage.rows, times }),
  );
  await context.say(lines.join("\n"));
}
