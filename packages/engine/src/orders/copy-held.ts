import type { Clock } from "@binference/core";
import { hasHeldToTell } from "../notices/notice-hour.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { CopyOrder } from "./copy-fills.js";
import { copyHeldNotice } from "./copy-notice-hour.js";
import { copyOrdersIn } from "./copy-orders.js";
import { copyStateDocument, copyStateOf } from "./copy-state.js";
import { moveOrder } from "./order-machine.js";
import type { OrderStore } from "./ports.js";

/** What telling the held copy skips reads, writes and pushes. */
export interface CopyHeldParts {
  readonly orders: OrderStore;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

// Tells one order's held skips once its notice hour ended: the count is cleared first, under the
// version read, so a write another beat leaves it to the next tick and nothing is told twice.
async function tellOne(parts: CopyHeldParts, order: CopyOrder, signal: AbortSignal) {
  const state = copyStateOf(order.triggerState);
  const hour = state?.notices;
  const nowMs = parts.clock.now();
  if (state === undefined || hour === undefined || !hasHeldToTell(hour, nowMs)) {
    return;
  }
  const triggerState = copyStateDocument.encode({ ...state, notices: { ...hour, held: 0 } });
  const move = moveOrder(order, { type: "trigger_kept", triggerState }, nowMs);
  const written = move.ok ? await parts.orders.move([move.value], { signal }) : undefined;
  if (written?.ok === true) {
    parts.publish({ topic: "notice", kind: "notice/new", data: copyHeldNotice(order, hour.held) });
  }
}

/**
 * Tells, once, each active copy order's skips that a notice hour that has ended held back, in one
 * line per order (the owner's choice, decision 0260). The orders' tick calls it.
 */
export async function tellHeldCopies(parts: CopyHeldParts, signal: AbortSignal): Promise<void> {
  const orders = await copyOrdersIn(parts.orders, { states: ["active"], signal });
  for (const order of orders) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    await tellOne(parts, order, signal);
  }
}
