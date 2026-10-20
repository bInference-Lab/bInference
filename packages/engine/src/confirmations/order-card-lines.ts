import type { AssetRef } from "@binference/chain";
import { BinferenceError, bpsPerWhole } from "@binference/core";
import type {
  CopyOrderRequest,
  DcaOrderRequest,
  LimitOrderRequest,
  StopLossOrderRequest,
  TakeProfitOrderRequest,
  TrailingOrderRequest,
} from "@binference/protocol";
import type { CardLine, CardValue } from "./card-line.js";

/**
 * An auto order `order/create` takes: one a price triggers (decision 0189), a DCA order, which its
 * periods fill (decision 0246), or a copy order, which its leader's trades fill (decision 0261).
 */
export type CardOrderRequest =
  | LimitOrderRequest
  | TakeProfitOrderRequest
  | StopLossOrderRequest
  | TrailingOrderRequest
  | DcaOrderRequest
  | CopyOrderRequest;

type FillSize = CardOrderRequest["size"];

/** What an order's summary line reads besides its request. */
export interface OrderLineFacts {
  /** A DCA order's first two runs after its card was drawn. */
  readonly firstRuns?: readonly [number, number];
  /** A copy order's leader's label in the agent's address book, which names it before its address. */
  readonly leaderLabel?: string;
}

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

// Spec 4, section 3.8: what a buy spends, a dollar value, an amount, or a share of what the wallet
// may spend of it (decision 0190).
function spendLine(spent: AssetRef, size: FillSize): CardLine {
  if ("usdMicros" in size) {
    return {
      key: "card.order.spend",
      values: { size: choice("usd"), usd: usd(size.usdMicros), asset: asset(spent) },
    };
  }
  if ("percentBps" in size) {
    return {
      key: "card.order.spend",
      values: {
        size: choice("share"),
        share: { type: "percent", bps: size.percentBps },
        asset: asset(spent),
      },
    };
  }
  const amount: CardValue = { type: "amount", amount: { asset: spent, base: size.base } };
  return { key: "card.order.spend", values: { size: choice("other"), amount } };
}

// A buy order names what it spends once its rules filled the default (decision 0190). One stored
// before then took dollars only, and its card says the dollar value alone; any other size without
// what it spends cannot be drawn, so it is never confirmed.
function spendOf(request: LimitOrderRequest | DcaOrderRequest): CardLine {
  const { spend, size } = request;
  if (spend !== undefined) {
    return spendLine(spend, size);
  }
  if ("usdMicros" in size) {
    return {
      key: "card.order.spend",
      values: { size: choice("usdOnly"), usd: usd(size.usdMicros) },
    };
  }
  throw new BinferenceError({
    code: "engine.bad_document",
    message: "A buy order sized in base units or by share names nothing to spend.",
  });
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
          spend: { type: "line", line: spendOf(request) },
          condition,
        },
      }
    : {
        key: "card.order.summary.limitSell",
        values: { sell: { type: "line", line: sellLine(request.token, request.size) }, condition },
      };
}

// Spec 4, section 3.8: a DCA order buys with its spend on its period, in its zone, its count of
// times or until it ends (decision 0246).
function dcaLine(request: DcaOrderRequest, firstRuns?: readonly [number, number]): CardLine {
  const { cron, timezone, count } = request.trigger;
  if (firstRuns === undefined) {
    throw new BinferenceError({
      code: "engine.bad_document",
      message: "A DCA order's card needs its first runs.",
    });
  }
  const [first, second] = firstRuns;
  const schedule: CardLine = {
    key: "card.order.schedule",
    values: {
      cron: { type: "text", text: cron },
      zone: { type: "text", text: timezone ?? "UTC" },
      first: { type: "dateTime", atMs: first },
      second: { type: "dateTime", atMs: second },
    },
  };
  return {
    key: "card.order.summary.dca",
    values: {
      token: asset(request.token),
      spend: { type: "line", line: spendOf(request) },
      schedule: { type: "line", line: schedule },
      count: { type: "count", count: count ?? request.maxFills ?? 0 },
    },
  };
}

// Spec 4, section 3.8: a copy order copies its leader's buys with what it spends, at its dollars
// each, at most its daily dollars, and sells the share its leader sells; its leader by short
// address, after its label when the address book holds one.
function copyLine(request: CopyOrderRequest, leaderLabel: string | undefined): CardLine {
  const { leader, perBuyUsdMicros, dailyUsdMicros } = request.trigger;
  const account: CardValue = { type: "account", account: leader };
  const named: CardValue =
    leaderLabel === undefined
      ? account
      : {
          type: "line",
          line: {
            key: "card.order.leader",
            values: { label: { type: "text", text: leaderLabel }, account },
          },
        };
  return {
    key: "card.order.summary.copy",
    values: {
      leader: named,
      spend: asset(request.spend ?? request.token),
      perBuy: usd(perBuyUsdMicros),
      daily: usd(dailyUsdMicros),
    },
  };
}

/**
 * The summary of an auto order's card (spec 4, section 3.8): what it trades, and when; a DCA
 * order's with its first two runs, which `facts.firstRuns` must give; a copy order's with its
 * leader.
 */
export function orderSummaryLine(request: CardOrderRequest, facts: OrderLineFacts = {}): CardLine {
  if (request.kind === "limit") {
    return limitLine(request);
  }
  if (request.kind === "dca") {
    return dcaLine(request, facts.firstRuns);
  }
  if (request.kind === "copy") {
    return copyLine(request, facts.leaderLabel);
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
