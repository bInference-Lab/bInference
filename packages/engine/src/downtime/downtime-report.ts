import type { Id, JsonValue } from "@binference/core";
import type { OrderKind } from "../orders/order-record.js";
import type { Notice, NoticePart } from "../pushes/notice-push.js";
import { wholeUnitsOf } from "../records/whole-units.js";
import type { CheckedSkipReason } from "./downtime-check.js";

/** What the re-check found of one order: filled, or skipped with a reason. */
export interface CheckedOrder {
  readonly order: Id<"ord">;
  readonly agentId: Id<"agt">;
  readonly kind: OrderKind;
  readonly outcome: "filled" | "skipped";
  readonly reason?: CheckedSkipReason;
  /** How the owner reads the reason, when its message takes values: a cap's use and size. */
  readonly reasonPart?: NoticePart;
}

/** One resume's report: what kind of stop it was, how long, and what each order came to. */
export interface DowntimeReport {
  /** `start` once the engine started again in it, else `wake`: the machine slept. */
  readonly cause: "start" | "wake";
  /** When the engine last ran before the resume. */
  readonly offFromMs: number;
  /** How long the engine was off or asleep, every resume the re-check joined counted. */
  readonly offMs: number;
  readonly orders: readonly CheckedOrder[];
}

/** How long the engine was off: whole days, else whole hours, else whole minutes, else under one. */
function downtimePart(offMs: number): NoticePart {
  const units = wholeUnitsOf(offMs);
  return units === undefined
    ? { key: "order.underMinute", values: {} }
    : { key: units.key, values: { count: String(units.count) } };
}

// A reason's message as the owner reads it: the part its fill's notice carried, else the reason's
// message with no values; none for a reason whose message needs values no notice gave.
const valuedReasons: ReadonlySet<string> = new Set(["daily_cap", "copy_daily_cap"]);

function reasonPartOf(order: CheckedOrder): NoticePart | undefined {
  const { reason, reasonPart } = order;
  if (reason === undefined) {
    return undefined;
  }
  if (reasonPart !== undefined) {
    return reasonPart;
  }
  return valuedReasons.has(reason) ? undefined : { key: `reason.${reason}`, values: {} };
}

// The most skip lines a notice carries (spec 4, section 4): the rest go in one line.
const maxSkipLines = 3;

/** The skips of one reason: its message, and how many orders it skipped. */
interface ReasonCount {
  readonly code: string;
  readonly part: NoticePart;
  readonly count: number;
}

// The skipped orders counted by reason, the most first, then by the reason's code; a skip whose
// reason has no message to show counts as other.
function reasonCounts(orders: readonly CheckedOrder[]): {
  readonly counts: readonly ReasonCount[];
  readonly other: number;
} {
  const skips = orders.filter(({ outcome }) => outcome === "skipped");
  const shown: readonly Omit<ReasonCount, "count">[] = skips.flatMap((order) => {
    const part = reasonPartOf(order);
    return part === undefined || order.reason === undefined ? [] : [{ code: order.reason, part }];
  });
  const codes = [...new Set(shown.map(({ code }) => code))];
  const counts: readonly ReasonCount[] = codes.map((code) => {
    const own = shown.filter((skip) => skip.code === code);
    return { code, part: own[0]?.part ?? { key: `reason.${code}`, values: {} }, count: own.length };
  });
  const sorted = counts.toSorted(
    (left, right) => right.count - left.count || left.code.localeCompare(right.code),
  );
  return { counts: sorted, other: skips.length - shown.length };
}

function skipLines(orders: readonly CheckedOrder[]): readonly NoticePart[] {
  const { counts, other } = reasonCounts(orders);
  const lines = counts.slice(0, maxSkipLines).map(({ part, count }) => ({
    key: "order.resumedSkips",
    values: { count: String(count) },
    parts: { reason: part },
  }));
  const rest = other + counts.slice(maxSkipLines).reduce((sum, { count }) => sum + count, 0);
  return rest === 0
    ? lines
    : [...lines, { key: "order.resumedOther", values: { count: String(rest) } }];
}

/** The counts of a report's orders: checked is filled plus skipped. */
function countsOf(orders: readonly CheckedOrder[]): {
  readonly checked: number;
  readonly filled: number;
  readonly skipped: number;
} {
  const filled = orders.filter(({ outcome }) => outcome === "filled").length;
  return { checked: orders.length, filled, skipped: orders.length - filled };
}

/**
 * `notice.resumed` (spec 4, section 4; decision 0267): how long the engine was off or the machine
 * slept, how many orders the re-check checked, filled and skipped, and a line for each of the
 * three commonest reasons of the skips, the rest in one more line.
 */
export function resumedNotice(report: DowntimeReport): Notice {
  const counts = countsOf(report.orders);
  const after = skipLines(report.orders);
  return {
    key: "notice.resumed",
    values: {
      cause: report.cause,
      checked: String(counts.checked),
      filled: String(counts.filled),
      skipped: String(counts.skipped),
    },
    parts: { duration: downtimePart(report.offMs) },
    ...(after.length === 0 ? {} : { after }),
  };
}

// The most orders one agent's report names; its counts still count every order.
const maxReportOrders = 50;

/**
 * The fields of an agent's `inbox/resumeReport` (runtime spec, section 3.3): the counts of
 * `notice.resumed` for the agent's own orders, with each order's outcome and reason, at most 50,
 * so the agent can explain them.
 */
export function resumeReportPayload(report: DowntimeReport, agent: Id<"agt">): JsonValue {
  const own = report.orders.filter(({ agentId }) => agentId === agent);
  return {
    cause: report.cause,
    offFrom: report.offFromMs,
    offMs: report.offMs,
    ...countsOf(own),
    orders: own
      .slice(0, maxReportOrders)
      .map(({ order, kind, outcome, reason }) =>
        reason === undefined ? { order, kind, outcome } : { order, kind, outcome, reason },
      ),
  };
}
