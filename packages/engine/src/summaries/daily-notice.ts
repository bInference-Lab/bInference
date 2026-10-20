import type { Id } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import type { SkipCount } from "../orders/fill-counts.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";
import type { DailySummaryRecord } from "./daily-summary-record.js";
import type { ModeFigures, SummaryFacts } from "./summary-facts.js";

/** The message key of the owner's daily summary (spec 4, section 4). */
const dailyNoticeKey = "notice.daily";

// Dollars read the same in every language (`$1.20`), so the notice carries them as text.
const dollars = createFormatter({ locale: "en", timeZone: "UTC" });

const hourMs = 3_600_000;
// A summary before this one measures the 24-hour change while it was taken 20 to 28 hours ago:
// a day across a change of the clocks is 23 or 25 hours long, and a summary may go out late.
const changeFromMs = 20 * hourMs;
const changeToMs = 28 * hourMs;
// The notice's lines after it: at most four, the last of them for every other reason past three.
const maxSkipLines = 4;

/** What one agent's daily summary is drawn from. */
export interface DailyNoticeInput {
  readonly agent: { readonly id: Id<"agt">; readonly name: string };
  readonly facts: SummaryFacts;
  /** The agent's summary before this one, whose totals the 24-hour change is measured against. */
  readonly before?: DailySummaryRecord;
  readonly nowMs: number;
}

// Whether the agent holds live funds now, or, when they cannot be read now, held some at its last
// summary.
function holdsLive(live: ModeFigures, before: DailySummaryRecord | undefined): boolean {
  return (live.totalUsdMicros ?? before?.liveUsdMicros ?? 0n) > 0n;
}

/**
 * Whether the agent has nothing to tell: it holds no live funds, and had no trade, fill, skip or
 * model spend in the last 24 hours, no open order, and nothing waiting for the owner (owner's
 * ruling, 2026-10-20: an agent that holds live funds always hears its value). `before` is its
 * last summary, whose live total stands in for one that cannot be read now. An idle agent's
 * summary is not sent.
 */
export function isIdle(facts: SummaryFacts, before?: DailySummaryRecord): boolean {
  const { live, paper, fills, waits } = facts;
  const counts = [
    live.trades,
    paper.trades,
    fills.filled,
    fills.skipped.length,
    facts.openOrders,
    waits.cards,
    waits.limits,
    waits.heldWallets,
  ];
  const isQuiet = counts.every((count) => count === 0) && facts.spendUsdMicros === 0n;
  return isQuiet && !waits.question && !holdsLive(live, before);
}

// The value of a message's `select` that shows a line.
const showLine = "yes";
const hideLine = "no";

// The total the summary before this one read, when it was taken 20 to 28 hours ago.
function totalBefore(input: DailyNoticeInput, mode: "live" | "paper"): bigint | undefined {
  const { before, nowMs } = input;
  const age = before === undefined ? undefined : nowMs - before.atMs;
  const isComparable = age !== undefined && age >= changeFromMs && age <= changeToMs;
  return isComparable ? before?.[mode === "live" ? "liveUsdMicros" : "paperUsdMicros"] : undefined;
}

// One mode's line: its total now and its 24-hour change, or that it could not be read, and what
// its trades realized.
function valueLine(figures: ModeFigures, mode: "live" | "paper", before?: bigint): NoticePart {
  const { totalUsdMicros: total, realizedUsdMicros } = figures;
  const realized = dollars.usdChange(realizedUsdMicros);
  if (total === undefined) {
    return { key: "daily.value", values: { mode, unread: "yes", realized } };
  }
  const change = before === undefined ? {} : { change: dollars.usdChange(total - before) };
  const values = { mode, unread: "no", value: dollars.usd(total), realized };
  return {
    key: "daily.value",
    values: { ...values, hasChange: before === undefined ? hideLine : showLine, ...change },
  };
}

// A mode is told when it holds something, traded, could not be read, or held something before.
function isTold(figures: ModeFigures, before?: bigint): boolean {
  const { totalUsdMicros: total } = figures;
  return total === undefined || total > 0n || figures.trades > 0 || (before ?? 0n) > 0n;
}

// A skip's reason as the summary words it: a reason that names a cap's figures names the cap.
function reasonPart({ reason }: SkipCount): NoticePart {
  if (reason === "daily_cap" || reason === "copy_daily_cap") {
    return { key: "daily.overCap", values: { cap: reason === "daily_cap" ? "agent" : "copy" } };
  }
  return { key: `reason.${reason}`, values: {} };
}

// One line per skip reason, the most frequent first; past four reasons, the rest in one line.
function skipLines(skipped: readonly SkipCount[]): readonly NoticePart[] {
  const shown = skipped.length > maxSkipLines ? skipped.slice(0, maxSkipLines - 1) : skipped;
  const lines = shown.map((skip) => ({
    key: "daily.skips",
    values: { count: String(skip.count) },
    parts: { reason: reasonPart(skip) },
  }));
  const rest = skipped.slice(shown.length).reduce((sum, { count }) => sum + count, 0);
  return rest === 0
    ? lines
    : [...lines, { key: "daily.skipsOther", values: { count: String(rest) } }];
}

// The line of the auto orders: their fills and skips in the window, and those open now.
function ordersLine(facts: SummaryFacts): NoticePart | undefined {
  const { fills, openOrders } = facts;
  const skipped = fills.skipped.reduce((sum, { count }) => sum + count, 0);
  if (fills.filled + skipped + openOrders === 0) {
    return undefined;
  }
  const values = { filled: fills.filled, skipped, open: openOrders };
  return {
    key: "daily.orders",
    values: Object.fromEntries(
      Object.entries(values).map(([name, n]: readonly [string, number]) => [name, String(n)]),
    ),
  };
}

/**
 * The owner's daily summary of one agent (spec 4, section 4): live and paper each on its own line
 * with its total now, its change since the summary 20 to 28 hours ago and what its trades realized,
 * never added together (decision 0134); the auto orders' fills, skips and open orders, each skip
 * reason on a line after it; the model spend against the daily budget; and what waits for the
 * owner. Dollars are written once, the same in both languages; the words follow the owner's
 * language as a surface writes them.
 */
export function dailyNotice(input: DailyNoticeInput): Notice {
  const { agent, facts } = input;
  const liveBefore = totalBefore(input, "live");
  const paperBefore = totalBefore(input, "paper");
  const isLiveTold = isTold(facts.live, liveBefore);
  const isPaperTold = isTold(facts.paper, paperBefore);
  const orders = ordersLine(facts);
  const spend = {
    spend: dollars.usd(facts.spendUsdMicros),
    budget: dollars.usd(facts.budgetUsdMicros),
  };
  const { waits } = facts;
  const after = skipLines(facts.fills.skipped);
  return {
    key: dailyNoticeKey,
    agent: agent.id,
    values: {
      agent: agent.name,
      live: isLiveTold ? showLine : hideLine,
      paper: isPaperTold ? showLine : hideLine,
      orders: orders === undefined ? hideLine : showLine,
      cards: String(waits.cards),
      question: waits.question ? showLine : hideLine,
      limits: String(waits.limits),
      held: String(waits.heldWallets),
    },
    parts: {
      ...(isLiveTold ? { liveLine: valueLine(facts.live, "live", liveBefore) } : {}),
      ...(isPaperTold ? { paperLine: valueLine(facts.paper, "paper", paperBefore) } : {}),
      ...(orders === undefined ? {} : { ordersLine: orders }),
      spendLine: { key: "daily.spend", values: spend },
    },
    ...(after.length === 0 ? {} : { after }),
  };
}
