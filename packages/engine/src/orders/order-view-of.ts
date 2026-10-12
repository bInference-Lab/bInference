import type { Id } from "@binference/core";
import type { OrderView } from "@binference/protocol";
import type { EnginePush } from "../pushes/engine-push.js";
import type { OrderRecord } from "./order-record.js";

/**
 * An order as every surface draws it (protocol spec, section 8.3): its stored fields, and the card
 * that confirms it while it waits, then the card that confirmed it. Fills come with order fills.
 */
export function orderViewOf(order: OrderRecord, openCard?: Id<"crd">): OrderView {
  const card = order.cardId ?? openCard;
  return {
    order: order.id,
    agent: order.agentId,
    wallet: order.walletId,
    kind: order.kind,
    state: order.state,
    request: order.request,
    fills: order.fills,
    ...(order.maxFills === undefined ? {} : { maxFills: order.maxFills }),
    expiresAt: order.expiresAtMs,
    ...(card === undefined ? {} : { card }),
    intent: order.intentId,
    paper: order.isPaper,
    outsideContent: order.hasOutsideContent,
    ...(order.endReason === undefined ? {} : { endReason: order.endReason }),
    createdAt: order.createdAtMs,
    changedAt: order.changedAtMs,
  };
}

/** The `order/created` or `order/changed` push of an order as stored now. */
export function orderPush(order: OrderRecord, kind: "order/created" | "order/changed"): EnginePush {
  const data = {
    order: order.id,
    agent: order.agentId,
    state: order.state,
    version: order.version,
    changedAt: order.changedAtMs,
    ...(order.endReason === undefined ? {} : { endReason: order.endReason }),
  };
  return { topic: "order", kind, data };
}
