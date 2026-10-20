import type { Id } from "@binference/core";
import type { FillOutcome } from "../orders/fill-orders.js";
import type { OrderFillReason, OrderFillRecord } from "../orders/order-fill.js";
import { hasPriceTrigger, type OrderKind, type OrderRecord } from "../orders/order-record.js";
import type { ResumeFence, TriggerVerdict } from "../orders/resume-fence.js";

/**
 * Why the downtime re-check counts a checked order as skipped though no fill row says so
 * (decision 0267): `trigger_not_met`, the first price read after the resume does not meet its
 * trigger; `rearming`, the order filled before and fires again once its price left the trigger
 * and came back; `behind_fill`, its fill waited behind another fill of its agent or after its
 * last skips; `no_fresh_price`, no price of its token was read in the two minutes after the
 * resume; `position_closed`, an exit order whose position another sale emptied. Each order waits
 * on and fires at a later price.
 */
export const downtimeReasons = [
  "trigger_not_met",
  "rearming",
  "behind_fill",
  "no_fresh_price",
  "position_closed",
] as const;

/** A reason the re-check gives a skipped order: a fill's own reason or one of its own. */
export type CheckedSkipReason = OrderFillReason | (typeof downtimeReasons)[number];

/** What caused a resume: a start after a stop, a sleep of the machine, or its clock set back. */
export type ResumeCause = "start" | "wake" | "clock";

/**
 * Where one price order stands in a re-check: waiting for a fresh price, filling since `atMs`,
 * filled, handed to the executor, or skipped; `fromRow` when the reason is its fill's skip row.
 */
type Standing =
  | { readonly state: "pending" }
  | { readonly state: "firing"; readonly atMs: number }
  | { readonly state: "filled"; readonly atMs: number }
  | { readonly state: "sent"; readonly atMs: number }
  | {
      readonly state: "skipped";
      readonly reason: CheckedSkipReason;
      readonly atMs: number;
      readonly fromRow?: true;
    };

/** One order a re-check took: its agent, its kind and, for a price order, where it stands. */
export interface WatchedOrder {
  readonly agentId: Id<"agt">;
  readonly kind: OrderKind;
  readonly standing: Standing;
}

/** An open re-check as the report reads it: the resumes it joined and the orders it took. */
export interface OpenCheck {
  /** `start` once a start joined it, else `clock` once a clock step did, else `wake`. */
  readonly cause: ResumeCause;
  readonly offFromMs: number;
  readonly offMs: number;
  /** The first resume's instant: a skip row from then on may belong to the re-check. */
  readonly sinceMs: number;
  readonly orders: ReadonlyMap<Id<"ord">, WatchedOrder>;
  /** The one skip row of each order the report tells in place of the row's own notices. */
  readonly held: ReadonlyMap<Id<"ord">, OrderFillRecord>;
}

/** One resume as the re-check takes it: its cause, its span and the orders active then. */
interface Resume {
  readonly cause: ResumeCause;
  readonly offFromMs: number;
  readonly offMs: number;
  readonly atMs: number;
  readonly orders: readonly Pick<OrderRecord, "id" | "agentId" | "kind">[];
}

/**
 * The reasons a DCA or copy order's skip row has in a re-check because it came during the
 * downtime (decisions 0246 and 0260): a missed period, a late buy, a sale past its hour.
 */
export const downtimeRowReasons: ReadonlySet<string> = new Set([
  "missed",
  "late",
  "copy_sale_lapsed",
]);

/** The downtime re-check's state between resumes, which the fence answers from. */
export interface DowntimeCheck extends ResumeFence {
  /**
   * Fences off every price read before `atMs`, and every judgment and fill made before it, at
   * once: the first step of each resume, before the orders to check are read.
   */
  fence(atMs: number): void;
  /** The open re-check as it stands, if one is open. */
  open(): OpenCheck | undefined;
  /** The latest resume's instant, or `undefined` before the first. */
  resumedAt(): number | undefined;
  /** Opens a re-check over the orders active at the resume, or joins the open one. */
  begin(resume: Resume): void;
  /** Holds every judgment until the orders of a resume under way are read. */
  beginning(read: Promise<void>): void;
  /** Ends the open re-check. */
  close(): void;
  /**
   * Sets what the fence asks before it answers whether a price or a fill is stale: the
   * composition root's check for a pause, which fences a pause it finds at once.
   */
  probe(findPause: () => boolean): void;
}

const causeRank: Readonly<Record<ResumeCause, number>> = { wake: 0, clock: 1, start: 2 };

// What the end of a fill the re-check's judgment started makes of its order. A fill stands; any
// other end of a fill a resume overtook leaves the order waiting for a fresh price.
function endOf(
  outcome: FillOutcome,
  call: { readonly isStale: boolean; readonly atMs: number; readonly held?: OrderFillRecord },
): Standing {
  const { isStale, atMs, held } = call;
  if (outcome === "filled") {
    return { state: "filled", atMs };
  }
  if (outcome === "sent") {
    return { state: "sent", atMs };
  }
  if (isStale || outcome === "inactive") {
    return { state: "pending" };
  }
  if (outcome === "ended") {
    return { state: "skipped", reason: "position_closed", atMs };
  }
  if (outcome === "waiting") {
    return { state: "skipped", reason: "behind_fill", atMs };
  }
  return { state: "skipped", reason: held?.reason ?? "fill_failed", atMs, fromRow: true };
}

const pending: Standing = { state: "pending" };

/** The open re-check's own state, which only these change. */
interface OpenState {
  readonly join: (resume: Resume) => void;
  readonly watched: (order: Id<"ord">) => WatchedOrder | undefined;
  readonly held: (order: Id<"ord">) => OrderFillRecord | undefined;
  readonly stand: (order: Id<"ord">, standing: Standing) => void;
  readonly holds: (row: OrderFillRecord) => boolean;
  readonly view: () => OpenCheck;
}

function createOpen(first: Resume): OpenState {
  const orders = new Map<Id<"ord">, WatchedOrder>();
  const held = new Map<Id<"ord">, OrderFillRecord>();
  const span = { cause: first.cause, offMs: 0 };
  const join = (resume: Resume): void => {
    span.offMs += Math.max(0, resume.offMs);
    span.cause = causeRank[resume.cause] > causeRank[span.cause] ? resume.cause : span.cause;
    resume.orders
      .filter(({ id }) => !orders.has(id))
      .forEach(({ id, agentId, kind }) => orders.set(id, { agentId, kind, standing: pending }));
  };
  join(first);
  // A price order's skip while the re-check's own fill of it runs, or a DCA or copy order's first
  // skip of the downtime; every other row is told as usual.
  const isOwn = (watched: WatchedOrder, row: OrderFillRecord): boolean =>
    hasPriceTrigger(watched.kind)
      ? watched.standing.state === "firing"
      : downtimeRowReasons.has(row.reason ?? "");
  return {
    join,
    watched: (order: Id<"ord">) => orders.get(order),
    held: (order: Id<"ord">) => held.get(order),
    stand(order, standing) {
      const watched = orders.get(order);
      if (watched !== undefined) {
        orders.set(order, { ...watched, standing });
      }
    },
    holds(row) {
      const watched = orders.get(row.orderId);
      const before = held.get(row.orderId);
      if (before !== undefined || watched === undefined) {
        return before?.id === row.id;
      }
      const isHeld = row.outcome === "skipped" && row.atMs >= first.atMs && isOwn(watched, row);
      if (isHeld) {
        held.set(row.orderId, row);
      }
      return isHeld;
    },
    view: (): OpenCheck => ({
      cause: span.cause,
      offFromMs: first.offFromMs,
      offMs: span.offMs,
      sinceMs: first.atMs,
      orders: new Map(orders),
      held: new Map(held),
    }),
  };
}

// The judgment's standing: firing, or skipped with what the price did to its trigger.
function judgedStanding(verdict: TriggerVerdict, atMs: number): Standing {
  return verdict === "fires"
    ? { state: "firing", atMs }
    : { state: "skipped", reason: verdict === "rearming" ? "rearming" : "trigger_not_met", atMs };
}

/** The fence's state between resumes, which only the check's methods change. */
interface CheckState {
  open?: OpenState;
  resumedAtMs?: number;
  resumes: number;
  findPause?: () => boolean;
}

// The order's standing when it is a price order the open re-check took.
function pricedOf(state: Readonly<CheckState>, order: Id<"ord">): WatchedOrder | undefined {
  const watched = state.open?.watched(order);
  return watched !== undefined && hasPriceTrigger(watched.kind) ? watched : undefined;
}

// The judgments and fill ends the open re-check takes: a price order's first judgment under the
// latest resume, and the end of the fill it started.
function judgingOf(state: Readonly<CheckState>): Pick<ResumeFence, "judged" | "fillEnded"> {
  return {
    judged({ order, resumes, verdict, atMs }) {
      const isFirst = pricedOf(state, order.id)?.standing.state === "pending";
      if (isFirst && resumes === state.resumes) {
        state.open?.stand(order.id, judgedStanding(verdict, atMs));
      }
    },
    fillEnded({ order, resumes, outcome }) {
      const standing = pricedOf(state, order)?.standing;
      if (standing?.state !== "firing") {
        return;
      }
      const held = state.open?.held(order);
      const call = { isStale: resumes < state.resumes, atMs: standing.atMs };
      state.open?.stand(order, endOf(outcome, held === undefined ? call : { ...call, held }));
    },
  };
}

/**
 * Creates the {@link DowntimeCheck} (decisions 0267 and 0268). It counts the resumes and keeps the
 * latest one's instant for as long as the engine runs: a price read before it is stale, and a
 * judgment or fill made under an earlier count no longer runs. While a re-check is open, each
 * price order active at a resume takes its outcome from its first judgment on a fresh price and
 * the fill that judgment started.
 */
export function createDowntimeCheck(): DowntimeCheck {
  const state: CheckState = { resumes: 0 };
  // Whoever asks first after a pause finds it: the fence is raised before the answer.
  const look = (): void => {
    state.findPause?.();
  };
  const reading = { done: Promise.resolve() };
  return {
    resumes() {
      look();
      return state.resumes;
    },
    isStale(readAtMs) {
      look();
      return state.resumedAtMs !== undefined && readAtMs < state.resumedAtMs;
    },
    ready: async () => reading.done,
    ...judgingOf(state),
    holds: (row) => state.open?.holds(row) === true,
    fence(atMs) {
      state.resumes += 1;
      // The latest resume's instant, earlier than the last after a clock set back.
      state.resumedAtMs = atMs;
    },
    open: () => state.open?.view(),
    resumedAt: () => state.resumedAtMs,
    begin(resume) {
      if (state.open === undefined) {
        state.open = createOpen(resume);
      } else {
        state.open.join(resume);
      }
    },
    beginning(read) {
      reading.done = read.catch(() => undefined);
    },
    close() {
      delete state.open;
    },
    probe(findPause) {
      state.findPause = findPause;
    },
  };
}
