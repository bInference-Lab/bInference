import { cardLineText } from "@binference/i18n";
import type { AssetInfos, CardLineView, CardValueView, OrderView } from "@binference/protocol";
import { assetValue } from "./asset-values.js";
import { callOrSay, type CommandContext } from "./command-context.js";

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
function copyLine(context: CommandContext, order: OrderView, assets: AssetInfos): string {
  const values = {
    trigger: { type: "line", line: triggerLine(order.request) },
    fills: { type: "count", count: order.fills },
    expiry: choice(context.formatter.dateTime(order.expiresAt)),
  } as const;
  const line = { key: "cmd.orders.copyItem", values };
  return cardLineText(line, { formatter: context.formatter, assets });
}

// The token's info comes with the page, so a token outside the registry has its name too.
function orderLine(context: CommandContext, order: OrderView, assets: AssetInfos): string {
  const { request } = order;
  if (request.kind === "copy") {
    return copyLine(context, order, assets);
  }
  const values = {
    kind: choice(request.kind),
    side: choice(request.side),
    token: assetValue(request.token, assets),
    trigger: { type: "line", line: triggerLine(request) },
    fills: { type: "count", count: order.fills },
    // The day matters for an expiry weeks away, so it is written in full here.
    expiry: choice(context.formatter.dateTime(order.expiresAt)),
  } as const;
  return cardLineText({ key: "cmd.orders.item", values }, { formatter: context.formatter, assets });
}

/** `/orders`: the active auto orders with their triggers and fills (spec 4, section 5). */
export async function runOrders(context: CommandContext): Promise<void> {
  const page = await callOrSay(context, "order/list", { state: "active" });
  if (page === undefined) {
    return;
  }
  const lines = page.items.map((order) => orderLine(context, order, page.assets ?? {}));
  await context.say(lines.length === 0 ? context.words("cmd.orders.none") : lines.join("\n"));
}
