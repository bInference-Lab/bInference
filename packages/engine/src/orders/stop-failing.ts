import type { Clock } from "@binference/core";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { stopAfterFailures } from "./fill-pacing.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import { orderPush } from "./order-view-of.js";
import type { OrderStore } from "./ports.js";

/**
 * Stops an order whose last fills failed on chain, five since its last fill (decision 0211): it is
 * cancelled, so no further transaction pays gas for it, and the owner hears why. Answers `ended`;
 * an order another write moved first is left to its next trigger, `inactive`.
 */
export async function stopFailing(
  parts: { readonly orders: OrderStore; readonly clock: Clock; readonly publish: PublishPush },
  call: { readonly order: OrderRecord; readonly signal: AbortSignal },
): Promise<"ended" | "inactive"> {
  const { order, signal } = call;
  const move = moveOrder(order, { type: "cancel_requested" }, parts.clock.now());
  const moved = move.ok ? await parts.orders.move([move.value], { signal }) : undefined;
  const [stopped] = moved?.ok === true ? moved.value : [];
  if (stopped === undefined) {
    return "inactive";
  }
  parts.publish(orderPush(stopped, "order/changed"));
  const values = { count: String(stopAfterFailures) };
  const orderKind = { key: "order.kind", values: { kind: order.kind } };
  const notice = { key: "notice.fillsFailing", agent: order.agentId, values, parts: { orderKind } };
  parts.publish(noticePush(notice));
  return "ended";
}
