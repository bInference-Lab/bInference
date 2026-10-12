import type { AssetRef } from "@binference/chain";
import { bpsPerWhole } from "@binference/core";
import type {
  LimitOrderRequest,
  StopLossOrderRequest,
  TakeProfitOrderRequest,
  TrailingOrderRequest,
} from "@binference/protocol";
import type { CardLine, CardValue } from "./card-line.js";

/** An auto order that a price triggers: the kinds `order/create` takes today (decision 0189). */
export type PriceOrderRequest =
  | LimitOrderRequest
  | TakeProfitOrderRequest
  | StopLossOrderRequest
  | TrailingOrderRequest;

type FillSize = PriceOrderRequest["size"];

const asset = (token: AssetRef): CardValue => ({ type: "asset", asset: token });
const usd = (usdMicros: bigint): CardValue => ({ type: "usd", usdMicros });
const choice = (value: string): CardValue => ({ type: "choice", choice: value });

// Spec 4, section 3.8: a sale of a share, of a dollar value, of everything, or of an amount.
function sellLine(token: AssetRef, size: FillSize): CardLine {
  if ("usdMicros" in size) {
    return {
      key: "card.order.sell",
      values: { size: choice("usd"), usd: usd(size.usdMicros), token: asset(token) },
    };
  }
  if ("percentBps" in size) {
    return size.percentBps === bpsPerWhole
      ? { key: "card.order.sell", values: { size: choice("all"), token: asset(token) } }
      : {
          key: "card.order.sell",
          values: {
            size: choice("share"),
            share: { type: "percent", bps: size.percentBps },
            token: asset(token),
          },
        };
  }
  const amount: CardValue = { type: "amount", amount: { asset: token, base: size.base } };
  return { key: "card.order.sell", values: { size: choice("other"), amount } };
}

// What a buy spends: a buy order takes its size in dollars (decision 0189).
function spendOf(token: AssetRef, size: FillSize): CardValue {
  if ("usdMicros" in size) {
    return usd(size.usdMicros);
  }
  return "percentBps" in size
    ? { type: "percent", bps: size.percentBps }
    : { type: "amount", amount: { asset: token, base: size.base } };
}

function limitLine(request: LimitOrderRequest): CardLine {
  const condition: CardValue = {
    type: "line",
    line: {
      key: "card.order.condition",
      values: { direction: choice(request.trigger.direction), price: usd(request.trigger.price) },
    },
  };
  return request.side === "buy"
    ? {
        key: "card.order.summary.limitBuy",
        values: {
          token: asset(request.token),
          spend: spendOf(request.token, request.size),
          condition,
        },
      }
    : {
        key: "card.order.summary.limitSell",
        values: { sell: { type: "line", line: sellLine(request.token, request.size) }, condition },
      };
}

/** The summary of an auto order's card (spec 4, section 3.8): what it trades, and when. */
export function orderSummaryLine(request: PriceOrderRequest): CardLine {
  if (request.kind === "limit") {
    return limitLine(request);
  }
  const sell: CardValue = { type: "line", line: sellLine(request.token, request.size) };
  if (request.kind === "trailing") {
    return {
      key: "card.order.summary.trailing",
      values: { sell, distance: { type: "percent", bps: request.trigger.distanceBps } },
    };
  }
  const key =
    request.kind === "takeProfit" ? "card.order.summary.takeProfit" : "card.order.summary.stopLoss";
  return { key, values: { sell, price: usd(request.trigger.price) } };
}
