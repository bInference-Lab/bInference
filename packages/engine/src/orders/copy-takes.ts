import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentStore } from "../ports.js";
import type { CopyOrder } from "./copy-fills.js";
import { type CopyRetry, type CopyState, type CopyTaking, maxRetries } from "./copy-state.js";
import { isLineHeld } from "./fill-faults.js";
import type { OrderFillReason } from "./order-fill.js";
import type { OrderStore } from "./ports.js";

/**
 * The reasons a mirrored sale's fill may pass by, so the sale is tried again a minute later, for an
 * hour from the leader's sale (the owner's choice, decision 0260): a locked engine, another fill
 * holding the line, a quote no venue or route answered, a fill that threw or ran past its deadline,
 * a live fill whose grant ran out in its queue. Any other reason ends it.
 */
const passingReasons: ReadonlySet<OrderFillReason> = new Set<OrderFillReason>([
  "engine_locked",
  "fill_waiting",
  "no_route",
  "venue_down",
  "fill_failed",
  "fill_lapsed",
]);

/** How long after a passing failure a mirrored sale is tried again. */
const retryEveryMs = 60_000;
/** How long from the leader's sale a mirrored sale is tried. */
const retryForMs = 3_600_000;

// The newest rows of an order a take's row is looked for in: a take ends in one row, and a stop
// cuts off at most the newest.
const rowsRead = 12;

/** What finding how a take ended reads: the order's rows and its agent's live fills in flight. */
export interface TakeParts {
  readonly orders: Pick<OrderStore, "fills">;
  readonly intents: Pick<IntentStore, "fillsInFlight">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/**
 * How a copy order's take ended, by the rows that name it, never by a clock: still `open` while its
 * agent's live fill runs; `lost` when a stop cut it off, with no row and no live fill; `again` when
 * a sale's fill skipped for a passing reason, from that row's time; `done` otherwise.
 */
export type TakeEnd =
  | { readonly kind: "open" }
  | { readonly kind: "lost" }
  | { readonly kind: "again"; readonly atMs: number }
  | { readonly kind: "done" };

/** How the order's take ended, by its rows (decision 0260). */
export async function takeEndOf(
  parts: TakeParts,
  call: { readonly order: CopyOrder; readonly taking: CopyTaking; readonly signal: AbortSignal },
): Promise<TakeEnd> {
  const { order, taking, signal } = call;
  const rows = await parts.orders.fills({ orderId: order.id, limit: rowsRead }, { signal });
  const own = rows.find(({ copy }) => copy?.take === taking.take);
  if (own === undefined) {
    return (await isLineHeld(parts, order, signal)) ? { kind: "open" } : { kind: "lost" };
  }
  const isPassing = own.reason !== undefined && passingReasons.has(own.reason);
  return own.outcome === "skipped" && isPassing && taking.side === "sell"
    ? { kind: "again", atMs: own.atMs }
    : { kind: "done" };
}

/** When a sale that ended so is tried again; none when it is done or out of room. */
export function retryAtOf(end: TakeEnd, state: CopyState, nowMs: number): number | undefined {
  if (state.retries.length >= maxRetries) {
    return undefined;
  }
  if (end.kind === "lost") {
    return nowMs;
  }
  return end.kind === "again" ? end.atMs + retryEveryMs : undefined;
}

/** Whether a sale waiting to be sold again is past its hour from the leader's sale. */
export function isRetryLapsed(retry: Pick<CopyRetry, "atMs">, nowMs: number): boolean {
  return nowMs > retry.atMs + retryForMs;
}
