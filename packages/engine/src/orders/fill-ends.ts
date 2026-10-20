import type { Clock, Id, IdSource } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import { isFillAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { createIntentStateMachine, type IntentStep } from "../intents/state-machine.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { type DueRow, toldOf } from "./copy-notice-hour.js";
import { copyLinkOf } from "./copy-state.js";
import { type LandedFillParts, landedFillWrite } from "./fill-landed.js";
import { skippedNotice } from "./fill-notices.js";
import { isNewReason, paceRows } from "./fill-pacing.js";
import type { OrderFillReason, OrderFillRecord, OrderFillWrite } from "./order-fill.js";
import { moveOrder } from "./order-machine.js";
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
  /** What a copy order's buys used of the daily cap it would pass, and the cap (decision 0260). */
  readonly cap?: { readonly usedUsdMicros: bigint; readonly capUsdMicros: bigint };
  /** The agent's address book, which names a copy order's leader; the intent's when it has one. */
  readonly book?: readonly AddressEntryRecord[];
  readonly signal: AbortSignal;
}

// What the owner reads of a skip for the rolling cap: what the agent used of it, and the cap.
async function capOf(parts: SkipRowParts, skip: SkipOf) {
  const { intent, reason, signal } = skip;
  if (skip.cap !== undefined) {
    return skip.cap;
  }
  if (intent === undefined || reason !== "daily_cap" || parts.spent === undefined) {
    return undefined;
  }
  const usedUsdMicros = await parts.spent(intent, { signal });
  return { usedUsdMicros, capUsdMicros: intent.settings.limits.rollingDayUsdMicros };
}

// Whether the owner hears the skip: as told, a copy order's always, or once per reason in a row
// (decision 0197).
async function tells(parts: SkipRowParts, skip: SkipOf): Promise<boolean> {
  if (skip.tells !== undefined) {
    return skip.tells;
  }
  // Every copy skip is told, within its order's notice hour as it is announced (decision 0260).
  if (skip.order.kind === "copy") {
    return true;
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
    ...copyLinkOf(order, order.kind),
  };
  if (!(await tells(parts, skip))) {
    return row;
  }
  const cap = await capOf(parts, skip);
  const book = intent?.settings.addressBook ?? skip.book ?? [];
  const risk = intent?.record.risk;
  const notice = skippedNotice(order, {
    reason,
    book,
    ...(cap === undefined ? {} : { cap }),
    ...(risk === undefined ? {} : { risk }),
  });
  return { ...row, notices: [noticePush(notice).data] };
}

/** The order whose fill an intent is; `undefined` for any other intent. */
export function fillOrderOf(snapshot: IntentSnapshot): Id<"ord"> | undefined {
  const { authorizedBy } = snapshot.stored.status;
  return authorizedBy !== undefined && isFillAuthorization(authorizedBy) && "order" in authorizedBy
    ? authorizedBy.order
    : undefined;
}

/** Why a step ended a fill without filling, and whether the owner hears it on the row. */
interface SkipEnd {
  readonly reason: OrderFillReason;
  /** False when the executor tells the owner of the end itself; once per reason in a row else. */
  readonly tells?: false;
}

// Whether the owner withdrew the fill: a cancel an `intent/cancel` call made, not the engine. The
// fill's order ends with it, or its trigger, still met, would fire the same fill again (decision
// 0211).
function isOwnerCancel(move: IntentMove): boolean {
  const { status, event } = move.step;
  return (
    status.state === "cancelled" &&
    event.cancelCause === "request" &&
    move.by !== undefined &&
    move.by !== "engine"
  );
}

// How a live fill's executor ends it without a fill (decision 0210): its authorization ran out in
// the queue, it was never signed, or it failed on chain. The executor's own notice tells the owner.
function liveEndOf(step: IntentStep): SkipEnd | undefined {
  const { status, event } = step;
  if (status.state === "expired") {
    return { reason: "fill_lapsed", tells: false };
  }
  if (status.state === "failed_onchain") {
    return { reason: status.reason ?? "fill_failed", tells: false };
  }
  const isUnsigned = event.cancelCause === "step_unsent" || event.cancelCause === "engine_stopping";
  return status.state === "cancelled" && isUnsigned
    ? { reason: "fill_failed", tells: false }
    : undefined;
}

// Why a step ends a fill without filling: its refusal's reason, `frozen` for a freeze's cancel, or
// the end of a live fill the executor ran. Any other end, such as a cancel the fill made itself,
// is no skip.
function skipEndOf(before: IntentSnapshot, move: IntentMove): SkipEnd | undefined {
  const { status, event } = move.step;
  if (isOwnerCancel(move)) {
    return { reason: "owner_cancelled" };
  }
  if (status.state === "cancelled" && event.cancelCause === "freeze") {
    return { reason: "frozen" };
  }
  const isRefusal = ["rejected_policy", "risk_blocked", "failed_check"].includes(status.state);
  if (isRefusal) {
    return status.reason === undefined ? undefined : { reason: status.reason };
  }
  return before.record.isPaper ? undefined : liveEndOf(move.step);
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

/** What the write that ends a fill reads, and a landed live fill's write with it. */
export interface FillEndParts extends SkipRowParts {
  /**
   * What a live fill that landed writes on its order with, in the move that reconciles it
   * (decision 0210); the executor's writer has it, and a writer without it records none.
   */
  readonly landed?: Omit<LandedFillParts, "orders" | "ids">;
}

// The live fill a move reconciles: the trade it settled; `undefined` for any other move.
function landedOf(move: IntentMove): SettledTrade | undefined {
  return move.step.status.state === "reconciled" ? move.settled : undefined;
}

/**
 * Creates the {@link FillEnd} the one writer of intents adds to each move: a skip's row, or, with
 * `landed`, a live fill's write on its order as it reconciles.
 */
// A landed live fill's write on its order, once: none when its fill was counted already.
async function landedWrite(
  parts: FillEndParts & { readonly landed: NonNullable<FillEndParts["landed"]> },
  call: {
    readonly order: OrderRecord;
    readonly before: IntentSnapshot;
    readonly settled: SettledTrade;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<OrderFillWrite | undefined> {
  const { order, before, settled, atMs, signal } = call;
  const landing = { ...parts.landed, orders: parts.orders, ids: parts.ids };
  const counted = await parts.orders.countedFill(before.record.id, { signal });
  if (counted !== undefined) {
    return undefined;
  }
  const write = { order, snapshot: before, settled, isBooked: true, atMs, signal };
  return landedFillWrite(landing, write);
}

// A skip's row with its notice; an owner's cancel ends the order with it (decision 0211).
async function skipWrite(
  parts: FillEndParts,
  call: SkipOf & { readonly ended: SkipEnd },
): Promise<OrderFillWrite> {
  const { ended, order, atMs } = call;
  const fill = await skipRowOf(parts, { ...call, ...ended });
  const ends =
    ended.reason === "owner_cancelled"
      ? moveOrder(order, { type: "cancel_requested" }, atMs)
      : undefined;
  return { moves: ends?.ok === true ? [ends.value] : [], fill };
}

/**
 * Creates the {@link FillEnd} the one writer of intents adds to each move: a skip's row, or, with
 * `landed`, a live fill's write on its order as it reconciles.
 */
export function createFillEnd(parts: FillEndParts): FillEnd {
  return async (before, move, { signal }) => {
    const orderId = fillOrderOf(before);
    const settled = landedOf(move);
    const ended = skipEndOf(before, move);
    const { landed } = parts;
    const lands = settled !== undefined && landed !== undefined;
    if (move.order !== undefined || orderId === undefined || (!lands && ended === undefined)) {
      return undefined;
    }
    const order = await parts.orders.get(orderId, { signal });
    const atMs = move.step.event.atMs;
    if (order === undefined) {
      return undefined;
    }
    if (settled !== undefined && landed !== undefined) {
      return landedWrite({ ...parts, landed }, { order, before, settled, atMs, signal });
    }
    return ended === undefined
      ? undefined
      : skipWrite(parts, { order, ended, reason: ended.reason, intent: before, atMs, signal });
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
 * Tells the owner the notices of rows not yet announced, oldest first, order by order, then marks
 * them announced (decision 0197); a copy order's skips past five in its hour are counted instead
 * and told in one line (decision 0260). A stop between the two tells them again at the next start.
 */
export async function announceRows(
  parts: AnnounceParts,
  rows: readonly OrderFillRecord[],
  signal: AbortSignal,
): Promise<number> {
  const due = rows.filter(
    (row): row is DueRow => row.notices !== undefined && row.announcedAtMs === undefined,
  );
  if (due.length === 0) {
    return 0;
  }
  // Each order's rows together, in the order their first row came; a copy order's skips within its
  // notice hour (decision 0260).
  const orders = [...new Set(due.map(({ orderId }) => orderId))];
  for (const orderId of orders) {
    const own = due.filter((row) => row.orderId === orderId);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one order's notices after another's
    const told = await toldOf(parts, own, signal);
    told.forEach((data) => {
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

/**
 * The skip of a proposal the money path refused before storing an intent: a route or venue it
 * could not find, by its own name; anything else, such as an agent archived meanwhile, a fault of
 * the fill, told once and paced.
 */
export function proposalSkipOf(code: ProtocolErrorCode): OrderFillReason {
  if (code === "quote.no_route") {
    return "no_route";
  }
  return code === "quote.venue_down" ? "venue_down" : "fill_failed";
}
