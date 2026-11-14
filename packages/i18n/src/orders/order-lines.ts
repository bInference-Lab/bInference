import type { CardLineView, CardValueView, OrderView } from "@binference/protocol";
import { assetValue } from "../cards/asset-values.js";
import { type CardDisplay, cardLineText } from "../cards/card-text.js";

type Request = OrderView["request"];

function choice(value: string): CardValueView {
  return { type: "choice", choice: value };
}

function priceLine(direction: string, price: bigint): CardLineView {
  return {
    key: "cmd.orders.price",
    values: { direction: choice(direction), price: { type: "usd", usdMicros: price } },
  };
}

function triggerLine(request: Request): CardLineView {
  if (request.kind === "limit") {
    return priceLine(request.trigger.direction, request.trigger.price);
  }
  if (request.kind === "takeProfit" || request.kind === "stopLoss") {
    return priceLine("at", request.trigger.price);
  }
  if (request.kind === "trailing") {
    const distance = { type: "percent", bps: request.trigger.distanceBps } as const;
    return { key: "cmd.orders.trailing", values: { distance } };
  }
  if (request.kind === "dca") {
    const cron = { type: "text", text: request.trigger.cron } as const;
    return { key: "cmd.orders.schedule", values: { cron } };
  }
  const leader = { type: "account", account: request.trigger.leader } as const;
  const perBuy = { type: "usd", usdMicros: request.trigger.perBuyUsdMicros } as const;
  return { key: "cmd.orders.copy", values: { leader, perBuy } };
}

// A copy order trades every token its leader trades, so its line names the leader and its dollars
// per buy instead of a side and a token.
function copyLine(order: OrderView, display: CardDisplay): string {
  const values = {
    trigger: { type: "line", line: triggerLine(order.request) },
    fills: { type: "count", count: order.fills },
    expiry: choice(display.formatter.dateTime(order.expiresAt)),
  } as const;
  return cardLineText({ key: "cmd.orders.copyItem", values }, display);
}

/**
 * An auto order as every list of orders names it: its kind, its side and token, its trigger, its
 * fills and its end. The display's `assets` are the info its page carries, so a token the registry
 * does not list shows by what its proposal stored, and one the page lacks by its short address.
 */
export function orderLineText(order: OrderView, display: CardDisplay): string {
  const { request } = order;
  if (request.kind === "copy") {
    return copyLine(order, display);
  }
  const values = {
    kind: choice(request.kind),
    side: choice(request.side),
    token: assetValue(request.token, display.assets),
    trigger: { type: "line", line: triggerLine(request) },
    fills: { type: "count", count: order.fills },
    // The day matters for an expiry weeks away, so it is written in full here.
    expiry: choice(display.formatter.dateTime(order.expiresAt)),
  } as const;
  return cardLineText({ key: "cmd.orders.item", values }, display);
}
