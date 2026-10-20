import type { Id } from "@binference/core";
import type { FillOutcome } from "../orders/fill-orders.js";
import type { OrderFillReason, OrderFillRecord } from "../orders/order-fill.js";
import { hasPriceTrigger, type OrderKind, type OrderRecord } from "../orders/order-record.js";
import type { ResumeFence } from "../orders/resume-fence.js";

/**
 * Why the downtime re-check counts a checked order as skipped though no fill row says so
 * (decision 0267): `trigger_not_met`, the first price read after the resume does not meet its
 * trigger, and the order waits on; `no_fresh_price`, no price of its token was read in the two
 * minutes after the resume; `position_closed`, an exit order whose position another sale emptied.
 */
export const downtimeReasons = ["trigger_not_met", "no_fresh_price", "position_closed"] as const;

/** A reason the re-check gives a skipped order: a fill's own reason or one of its own. */
export type CheckedSkipReason = OrderFillReason | (typeof downtimeReasons)[number];

/** Where one order stands in a re-check: waiting for a fresh price, filling, or done. */
type Standing =
  | { readonly state: "pending" }
  | { readonly state: "firing" }
  | { readonly state: "filled" }
  | { readonly state: "skipped"; readonly reason: CheckedSkipReason; readonly fromRow?: true };

/** One order a re-check took: its agent, its kind and, for a price order, where it stands. */
export interface WatchedOrder {
  readonly agentId: Id<"agt">;
  readonly kind: OrderKind;
  readonly standing: Standing;
}

/** An open re-check as the report reads it: the resumes it joined and the orders it took. */
export interface OpenCheck {
  /** `start` once a start joined it, else `wake`. */
  readonly cause: "start" | "wake";
  readonly offFromMs: number;
  readonly offMs: number;
  /** The first resume's instant: a skip row from then on may belong to the re-check. */
  readonly sinceMs: number;
  readonly orders: ReadonlyMap<Id<"ord">, WatchedOrder>;
  /** The one skip row of each order the report tells in place of the row's own notices. */
  readonly held: ReadonlyMap<Id<"ord">, OrderFillRecord>;
}

/** One resume as the re-check takes it: its kind, its span and the orders active then. */
interface Resume {
  readonly cause: "start" | "wake";
  readonly offFromMs: number;
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
}

/** What one fill's end makes of its order: a standing, its skip row to read, or none at all. */
type FillEnd = Standing | "skip_row" | "leaves";

// What a fill that did not fill makes of its order.
const otherEnds: Readonly<Record<Exclude<FillOutcome, "filled" | "sent">, FillEnd>> = {
  skipped: "skip_row",
  ended: { state: "skipped", reason: "position_closed" },
  waiting: { state: "skipped", reason: "fill_waiting" },
  inactive: "leaves",
};

// What a fill's end makes of its order. A fill stands; any other end of a fill whose price was
// read before a resume that came while it ran leaves the order waiting for a fresh price.
function endOf(outcome: FillOutcome, after: { readonly isStale: boolean }): FillEnd {
  if (outcome === "filled" || outcome === "sent") {
    return { state: "filled" };
  }
  return after.isStale ? { state: "pending" } : otherEnds[outcome];
}

const pending: Standing = { state: "pending" };

/** The open re-check's own state, which only these change. */
interface OpenState {
  readonly join: (resume: Resume) => void;
  readonly watched: (order: Id<"ord">) => WatchedOrder | undefined;
  readonly stand: (order: Id<"ord">, end: FillEnd) => void;
  readonly holds: (row: OrderFillRecord) => boolean;
  readonly view: () => OpenCheck;
}

// A price order's skip while the re-check's own fill of it runs, or a DCA or copy order's first
// skip of the downtime; every other row is told as usual.
function isOwn(watched: WatchedOrder, row: OrderFillRecord): boolean {
  return hasPriceTrigger(watched.kind)
    ? watched.standing.state === "firing"
    : downtimeRowReasons.has(row.reason ?? "");
}

function createOpen(first: Resume): OpenState {
  const orders = new Map<Id<"ord">, WatchedOrder>();
  const held = new Map<Id<"ord">, OrderFillRecord>();
  const span = { cause: first.cause, offMs: 0 };
  const join = (resume: Resume): void => {
    span.offMs += Math.max(0, resume.atMs - resume.offFromMs);
    span.cause = span.cause === "start" || resume.cause === "start" ? "start" : "wake";
    resume.orders
      .filter(({ id }) => !orders.has(id))
      .forEach(({ id, agentId, kind }) => orders.set(id, { agentId, kind, standing: pending }));
  };
  join(first);
  return {
    join,
    watched: (order) => orders.get(order),
    stand(order, end) {
      const watched = orders.get(order);
      if (watched === undefined || end === "leaves") {
        orders.delete(order);
        return;
      }
      const reason = held.get(order)?.reason ?? "fill_failed";
      const standing: Standing =
        end === "skip_row" ? { state: "skipped", reason, fromRow: true } : end;
      orders.set(order, { ...watched, standing });
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

/**
 * Creates the {@link DowntimeCheck} (decisions 0267 and 0268). It keeps the latest resume's
 * instant for as long as the engine runs: a price read before it is stale. While a re-check is
 * open, each price order active at a resume takes its outcome from its first judgment on a fresh
 * price and the fill that judgment started.
 */
export function createDowntimeCheck(): DowntimeCheck {
  const state: { open?: OpenState; resumedAtMs?: number } = {};
  const reading = { done: Promise.resolve() };
  const isStale = (readAtMs: number): boolean =>
    state.resumedAtMs !== undefined && readAtMs < state.resumedAtMs;
  const pricedStanding = (order: Id<"ord">): Standing["state"] | undefined => {
    const watched = state.open?.watched(order);
    return watched !== undefined && hasPriceTrigger(watched.kind)
      ? watched.standing.state
      : undefined;
  };
  return {
    isStale,
    ready: async () => reading.done,
    judged({ order, readAtMs, fires }) {
      if (pricedStanding(order.id) === "pending" && !isStale(readAtMs)) {
        const end: Standing = fires
          ? { state: "firing" }
          : { state: "skipped", reason: "trigger_not_met" };
        state.open?.stand(order.id, end);
      }
    },
    fillEnded({ order, readAtMs, outcome }) {
      if (pricedStanding(order) === "firing") {
        state.open?.stand(order, endOf(outcome, { isStale: isStale(readAtMs) }));
      }
    },
    holds: (row) => state.open?.holds(row) === true,
    open: () => state.open?.view(),
    resumedAt: () => state.resumedAtMs,
    begin(resume) {
      if (state.open === undefined) {
        state.open = createOpen(resume);
      } else {
        state.open.join(resume);
      }
      state.resumedAtMs = Math.max(state.resumedAtMs ?? resume.atMs, resume.atMs);
    },
    beginning(read) {
      reading.done = read.catch(() => undefined);
    },
    close() {
      delete state.open;
    },
  };
}
