import type { Clock, JsonValue } from "@binference/core";
import { countNotice, type NoticeHour } from "../notices/notice-hour.js";
import { noticePush } from "../pushes/notice-push.js";
import { asCopyOrder, type CopyOrder } from "./copy-fills.js";
import { copyStateDocument, copyStateOf } from "./copy-state.js";
import type { OrderFillRecord } from "./order-fill.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/** A fill row whose notices were not announced yet. */
export type DueRow = OrderFillRecord & { readonly notices: readonly JsonValue[] };

/**
 * The line that tells a copy order's skips its notice hour held back (the owner's choice, decision
 * 0260), muted with the skips.
 */
export function copyHeldNotice(order: Pick<OrderRecord, "agentId">, held: number): JsonValue {
  const notice = { key: "notice.copyHeld", agent: order.agentId, values: { count: String(held) } };
  return noticePush(notice).data;
}

/** What a copy order tells of its rows, and its notice hour after them. */
export interface CopyAnnouncement {
  readonly told: readonly JsonValue[];
  readonly hour?: NoticeHour;
}

/**
 * What a copy order tells of its rows, oldest first (decision 0260): every fill's notices, and its
 * skips' within its notice hour, five an hour; the rest are counted, and the first skip of the next
 * hour comes after one line that tells how many the hour before held back.
 */
export function copyAnnouncementOf(order: CopyOrder, rows: readonly DueRow[]): CopyAnnouncement {
  const told: JsonValue[] = [];
  const kept = { hour: copyStateOf(order.triggerState)?.notices };
  for (const row of rows) {
    if (row.outcome === "skipped") {
      const counted = countNotice(kept.hour, row.atMs);
      kept.hour = counted.window;
      if (counted.heldBefore > 0) {
        told.push(copyHeldNotice(order, counted.heldBefore));
      }
      told.push(...(counted.notify ? row.notices : []));
    } else {
      told.push(...row.notices);
    }
  }
  return kept.hour === undefined ? { told } : { told, hour: kept.hour };
}

/** What telling an order's rows reads, and where a copy order keeps its notice hour. */
export interface ToldParts {
  readonly orders: Pick<OrderStore, "get" | "move">;
  readonly clock: Clock;
}

// Keeps a copy order's notice hour in its state, under the version it read; answers whether the
// write landed. One that lost to another write of the order lands nothing.
async function keepHour(
  parts: ToldParts,
  order: CopyOrder,
  call: { readonly hour: NoticeHour | undefined; readonly signal: AbortSignal },
): Promise<boolean> {
  const state = copyStateOf(order.triggerState);
  if (state === undefined || call.hour === undefined) {
    return true;
  }
  const triggerState = copyStateDocument.encode({ ...state, notices: call.hour });
  const move = moveOrder(order, { type: "trigger_kept", triggerState }, parts.clock.now());
  const written = move.ok ? await parts.orders.move([move.value], { signal: call.signal }) : null;
  return written?.ok === true;
}

// How often a copy order's notice hour is counted again on a fresh read after its write lost to
// another write of the order, such as its runner's or the held line's.
const hourTries = 3;

// The order's notices, counted on the order as read now and kept in the same write as the hour;
// counted again on a fresh read when another write came first, so no count is lost and no held
// line is told twice. Past the last try they are told as counted: a count, never money.
async function toldCounted(
  parts: ToldParts,
  rows: readonly DueRow[],
  call: { readonly tries: number; readonly signal: AbortSignal },
): Promise<readonly JsonValue[] | undefined> {
  const { tries, signal } = call;
  const [first] = rows;
  const read = first === undefined ? undefined : await parts.orders.get(first.orderId, { signal });
  const copy = read === undefined ? undefined : asCopyOrder(read);
  if (copy === undefined) {
    return undefined;
  }
  const announcement = copyAnnouncementOf(copy, rows);
  const isKept = await keepHour(parts, copy, { hour: announcement.hour, signal });
  return isKept || tries <= 1
    ? announcement.told
    : toldCounted(parts, rows, { tries: tries - 1, signal });
}

/**
 * The notices one order's due rows tell, oldest first: all of them, or a copy order's within its
 * notice hour, which it keeps.
 */
export async function toldOf(
  parts: ToldParts,
  rows: readonly DueRow[],
  signal: AbortSignal,
): Promise<readonly JsonValue[]> {
  const told = await toldCounted(parts, rows, { tries: hourTries, signal });
  return told ?? rows.flatMap(({ notices }) => notices);
}
