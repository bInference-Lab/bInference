import { noticePush } from "../pushes/notice-push.js";
import { cancelCard } from "./cancel-order.js";
import type { OrderParts } from "./create-order.js";
import { moveOrder, orderExpiryNoticeMs, type OrderTrigger } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import { openOrderStates } from "./order-states.js";
import { orderPush } from "./order-view-of.js";

/** The message key of the notice that an auto order ends soon (spec 4, section 4). */
const orderExpiringNoticeKey = "notice.orderExpiring";

// How many orders one tick reads at most of each kind of work; the next tick reads on.
const pageSize = 500;

// Writes one order's move when the machine allows it; a move another write beat waits for the
// next tick. Answers the order after it, or `undefined` when nothing moved.
async function moved(
  parts: OrderParts,
  order: OrderRecord,
  call: { readonly trigger: OrderTrigger; readonly nowMs: number; readonly signal: AbortSignal },
): Promise<OrderRecord | undefined> {
  const move = moveOrder(order, call.trigger, call.nowMs);
  const written = move.ok ? await parts.orders.move([move.value], call) : undefined;
  const [after] = written?.ok === true ? written.value : [];
  if (after !== undefined) {
    parts.publish(orderPush(after, "order/changed"));
  }
  return after;
}

// Each order in turn, oldest first, so the writes land one after another.
async function eachInTurn(
  orders: readonly OrderRecord[],
  work: (order: OrderRecord) => Promise<void>,
): Promise<void> {
  await orders.reduce<Promise<void>>(async (done, order) => {
    await done;
    await work(order);
  }, Promise.resolve());
}

/**
 * Ends every auto order whose expiry came: an active, paused or waiting order becomes `expired`,
 * and a waiting one's card closes, so an expired order never fills (decision 0189).
 */
export async function expireDueOrders(parts: OrderParts, signal: AbortSignal): Promise<void> {
  const nowMs = parts.clock.now();
  const query = { states: openOrderStates, expiresByMs: nowMs, limit: pageSize };
  const due = await parts.orders.list(query, { signal });
  await eachInTurn(due, async (order) => {
    const after = await moved(parts, order, { trigger: { type: "expiry_reached" }, nowMs, signal });
    if (after !== undefined && order.state === "awaiting_confirmation") {
      await cancelCard(parts, order.intentId, signal);
    }
  });
}

/**
 * Sends `notice.orderExpiring` once for each active or paused auto order that expires within 24
 * hours, through the notice outbox, and keeps when it went on the order (decision 0189).
 */
export async function noticeExpiringOrders(parts: OrderParts, signal: AbortSignal): Promise<void> {
  const nowMs = parts.clock.now();
  const query = {
    states: ["active", "paused"] as const,
    expiresByMs: nowMs + orderExpiryNoticeMs,
    limit: pageSize,
  };
  const ending = await parts.orders.list(query, { signal });
  const unnoticed = ending.filter((order) => order.expiryNoticedAtMs === undefined);
  await eachInTurn(unnoticed, async (order): Promise<void> => {
    const trigger = { type: "expiry_noticed" } as const;
    const after = await moved(parts, order, { trigger, nowMs, signal });
    if (after !== undefined) {
      const orderKind = { key: "order.kind", values: { kind: order.kind } };
      const notice = {
        key: orderExpiringNoticeKey,
        agent: order.agentId,
        values: {},
        times: { when: order.expiresAtMs },
        parts: { orderKind },
      };
      parts.publish(noticePush(notice));
    }
  });
}
