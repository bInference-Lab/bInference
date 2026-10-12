import type { Clock, Id, IdSource, JsonValue } from "@binference/core";
import type { CapGate } from "../confirmations/cap-gate.js";
import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { createIntentStateMachine, type IntentStep } from "../intents/state-machine.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { skippedNotice } from "./fill-notices.js";
import { isNewReason, paceRows } from "./fill-pacing.js";
import type { OrderFillReason, OrderFillRecord, OrderFillWrite } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/** What a skip's row reads: the order's rows, the rolling cap's use, and new ids. */
export interface SkipRowParts {
  readonly orders: OrderStore;
  /** What the agent used of the rolling cap, which a skip for the cap reports; none when absent. */
  readonly spent?: CapGate["spent"];
  readonly ids: IdSource;
}

/** One skip of an order's fill, at `atMs`, with the intent that ended if one was stored. */
export interface SkipOf {
  readonly order: OrderRecord;
  readonly reason: OrderFillReason;
  readonly intent?: IntentSnapshot;
  readonly atMs: number;
  /** Whether the owner hears it; once per reason in a row for the order when absent. */
  readonly tells?: boolean;
  readonly signal: AbortSignal;
}

// What the owner reads of a skip for the rolling cap: what the agent used of it, and the cap.
async function capOf(parts: SkipRowParts, skip: SkipOf) {
  const { intent, reason, signal } = skip;
  if (intent === undefined || reason !== "daily_cap" || parts.spent === undefined) {
    return undefined;
  }
  const usedUsdMicros = await parts.spent(intent, { signal });
  return { usedUsdMicros, capUsdMicros: intent.settings.limits.rollingDayUsdMicros };
}

// Whether the owner hears the skip: as told, or once per reason in a row (decision 0197).
async function tells(parts: SkipRowParts, skip: SkipOf): Promise<boolean> {
  if (skip.tells !== undefined) {
    return skip.tells;
  }
  const query = { orderId: skip.order.id, limit: paceRows };
  return isNewReason(await parts.orders.fills(query, { signal: skip.signal }), skip.reason);
}

/**
 * A skip's `order_fills` row with the notice the owner hears of it, if any, both written in one
 * write: with the move that ends the skip's intent, or alone for a skip before any intent
 * (decision 0197).
 */
export async function skipRowOf(parts: SkipRowParts, skip: SkipOf): Promise<OrderFillRecord> {
  const { order, reason, intent, atMs } = skip;
  const row = {
    id: parts.ids.next("fil"),
    orderId: order.id,
    ...(intent === undefined ? {} : { intentId: intent.record.id }),
    outcome: "skipped" as const,
    reason,
    atMs,
  };
  if (!(await tells(parts, skip))) {
    return row;
  }
  const cap = await capOf(parts, skip);
  const notice = skippedNotice(order, cap === undefined ? { reason } : { reason, cap });
  return { ...row, notices: [noticePush(notice).data] };
}

/** The order whose fill an intent is; `undefined` for any other intent. */
export function fillOrderOf(snapshot: IntentSnapshot): Id<"ord"> | undefined {
  const { authorizedBy } = snapshot.stored.status;
  return authorizedBy !== undefined && isFillAuthorization(authorizedBy) && "order" in authorizedBy
    ? authorizedBy.order
    : undefined;
}

// Why a step ends a fill without filling: its refusal's reason, or `frozen` for a freeze's cancel.
// Any other end, such as a cancel the fill made itself, is no skip.
function skipReasonOf(step: IntentStep): OrderFillReason | undefined {
  const { status, event } = step;
  if (status.state === "cancelled") {
    return event.cancelCause === "freeze" ? "frozen" : undefined;
  }
  const isRefusal = ["rejected_policy", "risk_blocked", "failed_check"].includes(status.state);
  return isRefusal ? status.reason : undefined;
}

/**
 * The write on its order of a move that ends an order's fill without filling (decision 0197): the
 * skip's row with its notice, in the move's own transaction, so a stop after the move loses
 * neither. `undefined` for a move that carries its own, ends no fill, or is of no order's fill.
 */
export type FillEnd = (
  before: IntentSnapshot,
  move: IntentMove,
  options: { readonly signal: AbortSignal },
) => Promise<OrderFillWrite | undefined>;

/** Creates the {@link FillEnd} the one writer of intents adds to each move. */
export function createFillEnd(parts: SkipRowParts): FillEnd {
  return async (before, move, { signal }) => {
    const orderId = fillOrderOf(before);
    const reason = skipReasonOf(move.step);
    if (move.order !== undefined || orderId === undefined || reason === undefined) {
      return undefined;
    }
    const order = await parts.orders.get(orderId, { signal });
    if (order === undefined) {
      return undefined;
    }
    const atMs = move.step.event.atMs;
    const fill = await skipRowOf(parts, { order, reason, intent: before, atMs, signal });
    return { moves: [], fill };
  };
}

/** What cancelling a fill's intent writes through. */
export interface CancelFillParts extends SkipRowParts {
  readonly stored: StoredIntents;
  readonly clock: Clock;
}

/**
 * Cancels a fill's intent unsigned, with the skip's row and notice in the same write when it names
 * a skip (decision 0197). Answers the intent after it; one another write moved first, or that no
 * cancel can move, comes back as it is now.
 */
export async function cancelFill(
  parts: CancelFillParts,
  call: {
    readonly snapshot: IntentSnapshot;
    readonly skip?: { readonly order: OrderRecord; readonly reason: OrderFillReason };
    readonly cause?: "request" | "engine_stopping";
    readonly signal: AbortSignal;
  },
): Promise<IntentSnapshot> {
  const { snapshot, skip, signal } = call;
  const machine = createIntentStateMachine({ clock: parts.clock });
  const cause = call.cause ?? "request";
  const trigger = { type: "cancel_requested", cause, hasSignedStep: false } as const;
  const step = machine.apply(snapshot.stored.status, trigger);
  if (!step.ok) {
    return snapshot;
  }
  const atMs = step.value.event.atMs;
  const fill =
    skip === undefined
      ? undefined
      : await skipRowOf(parts, { ...skip, intent: snapshot, atMs, signal });
  const intent = snapshot.record.id;
  const move = {
    intent,
    version: snapshot.stored.version,
    step: step.value,
    by: "engine",
    ...(fill === undefined ? {} : { order: { moves: [], fill } }),
  };
  const moved = await parts.stored.move(move, { signal });
  return moved.ok ? moved.value : ((await parts.stored.snapshot(intent, { signal })) ?? snapshot);
}

/** Where announced notices go, and the rows they are marked on. */
export interface AnnounceParts {
  readonly orders: OrderStore;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

/**
 * Tells the owner the notices of rows not yet announced, oldest first, then marks them announced
 * (decision 0197). A stop between the two tells them again at the next start.
 */
export async function announceRows(
  parts: AnnounceParts,
  rows: readonly OrderFillRecord[],
  signal: AbortSignal,
): Promise<number> {
  const due = rows.filter(
    (row): row is OrderFillRecord & { readonly notices: readonly JsonValue[] } =>
      row.notices !== undefined && row.announcedAtMs === undefined,
  );
  if (due.length === 0) {
    return 0;
  }
  for (const row of due) {
    row.notices.forEach((data) => {
      parts.publish({ topic: "notice", kind: "notice/new", data });
    });
  }
  const ids = due.map(({ id }) => id);
  await parts.orders.markAnnounced({ ids, atMs: parts.clock.now() }, { signal });
  return due.length;
}

/** Announces an order's newest rows whose notices were not announced yet, and answers the rows. */
export async function announceOrder(
  parts: AnnounceParts,
  order: Id<"ord">,
  signal: AbortSignal,
): Promise<readonly OrderFillRecord[]> {
  const rows = await parts.orders.fills({ orderId: order, limit: paceRows }, { signal });
  await announceRows(parts, rows.toReversed(), signal);
  return rows;
}
