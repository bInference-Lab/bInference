import type { IntentOperationShapes } from "../operations/intent-operations.schema.js";
import type { LaunchpadOperationShapes } from "../operations/launchpad-operations.schema.js";
import type { MarketOperationShapes } from "../operations/market-operations.schema.js";
import type { OrderOperationShapes } from "../operations/order-operations.schema.js";
import {
  alertView,
  assets,
  at,
  ids,
  intentView,
  launchView,
  nativeAmount,
  pageOf,
  portfolioView,
  quoteView,
  refs,
  riskView,
  swapRequest,
  type WireExample,
} from "./wire-values.js";

const empty = {};
const alertCondition = { kind: "price", asset: refs.token, direction: "below", price: "900000" };
const asset = {
  asset: refs.token,
  symbol: "TKN",
  name: "Token",
  decimals: 6,
  verified: false,
  risk: riskView,
};

const trailingOrder = {
  kind: "trailing",
  agent: ids.agent,
  wallet: ids.wallet,
  token: refs.token,
  side: "sell",
  size: { percentBps: 5_000 },
  worstPrice: "1200000",
  maxSlippageBps: 100,
  expiresAt: at + 2_592_000_000,
  maxFills: 1,
  trigger: { distanceBps: 800 },
} as const;

const orderView = {
  order: ids.order,
  agent: ids.agent,
  wallet: ids.wallet,
  kind: "trailing",
  state: "active",
  request: trailingOrder,
  fills: 1,
  maxFills: 1,
  expiresAt: at + 2_592_000_000,
  createdAt: at,
  changedAt: at,
  fillHistory: [
    { fill: ids.fill, intent: ids.intent, outcome: "filled", at },
    { fill: ids.fill, outcome: "skipped", reason: "daily_cap", at },
  ],
} as const;

const ruleRequest = {
  agent: ids.agent,
  name: "breakout",
  token: refs.token,
  side: "buy",
  size: { usdMicros: "20000000" },
  maxFills: 3,
} as const;

const scheduleView = {
  schedule: ids.schedule,
  agent: ids.agent,
  when: { cron: "0 9 * * 1", timezone: "Asia/Shanghai" },
  prompt: "Review the week.",
  state: "active",
  nextAt: at,
  createdAt: at,
  lastRun: { due: at - 604_800_000, at: at - 604_800_000, outcome: "skipped", reason: "budget" },
} as const;

/** An example call of every market read operation. */
export const marketExamples: { readonly [N in keyof MarketOperationShapes]: WireExample } = {
  "portfolio/get": { args: { agent: ids.agent }, result: portfolioView },
  "portfolio/pnl": {
    args: { agent: ids.agent, from: at, to: at + 86_400_000, cards: true },
    result: {
      positions: [{ asset: refs.token, realizedUsdMicros: "-3000000" }],
      realizedUsdMicros: "-3000000",
      unrealizedUsdMicros: "1250000",
      paperPositions: [
        { asset: refs.token, realizedUsdMicros: "4500000", unrealizedUsdMicros: "-500000" },
      ],
      paperRealizedUsdMicros: "4500000",
      paperUnrealizedUsdMicros: "-500000",
      cards: [
        {
          asset: refs.token,
          paper: false,
          closed: true,
          lines: [
            {
              key: "pnl.closed",
              values: {
                realized: { type: "usdChange", usdMicros: "-3000000" },
                percent: { type: "percentChange", bps: "-2000" },
              },
            },
          ],
        },
      ],
      assets,
    },
  },
  "portfolio/resetPaper": {
    args: { agent: ids.agent, balances: [nativeAmount] },
    result: portfolioView,
  },
  "asset/get": { args: { asset: refs.token }, result: asset },
  "asset/search": { args: { chain: refs.chain, query: "TKN" }, result: pageOf(asset) },
  "name/resolve": {
    args: { name: "owner.bnb" },
    result: { name: "owner.bnb", address: refs.account, resolvedAt: at },
  },
  "quote/get": { args: swapRequest, result: quoteView },
  "risk/check": { args: { asset: refs.token }, result: riskView },
  "market/scan": {
    args: { chain: refs.chain, source: "trending", limit: 20 },
    result: {
      items: [
        {
          asset: refs.token,
          priceUsdMicros: "7525000",
          priceScale: 5,
          liquidityUsdMicros: "84000250000",
          volume24hUsdMicros: "250000500000",
          change24hBps: 31_245,
          activeBoosts: 1500,
          risk: riskView,
        },
      ],
      assets,
    },
  },
  "market/chart": {
    args: { asset: refs.token, interval: "4h", to: at, limit: 2 },
    result: {
      asset: refs.token,
      interval: "4h",
      candles: [
        {
          at: at - 28_800_000,
          openUsdMicros: "753470000",
          highUsdMicros: "754630000",
          lowUsdMicros: "749960000",
          closeUsdMicros: "750830000",
          volumeUsdMicros: "462391110553",
        },
        {
          at: at - 14_400_000,
          openUsdMicros: "750830000",
          highUsdMicros: "756780000",
          lowUsdMicros: "750090000",
          closeUsdMicros: "753960000",
          volumeUsdMicros: "1562492011515",
        },
      ],
      source: "candle-source",
    },
  },
  "launch/list": {
    args: { chain: refs.chain, from: at - 86_400_000, filters: { maxTaxBps: 300 }, limit: 1 },
    result: { items: [launchView], next: "1800000000000:128622596:278" },
  },
};

/** An example call of the launchpad read: one launchpad that uploads, one that takes a link. */
export const launchpadExamples: { readonly [N in keyof LaunchpadOperationShapes]: WireExample } = {
  "launchpad/list": {
    args: { chain: refs.chain },
    result: {
      items: [
        {
          venue: "fake-curve",
          picture: { place: "upload", mostBytes: 5_242_880 },
          settings: [{ name: "taxBps", type: "bps", max: 1_000, default: 100 }],
        },
        {
          venue: "fake-linked",
          picture: { place: "link" },
          settings: [{ name: "pictureLink", type: "link" }],
        },
      ],
    },
  },
};

/** An example call of every intent operation. */
export const intentExamples: { readonly [N in keyof IntentOperationShapes]: WireExample } = {
  "intent/propose": { args: swapRequest, result: intentView },
  "intent/get": { args: { intent: ids.intent }, result: intentView },
  "intent/card": {
    args: { intent: ids.intent },
    result: {
      card: ids.card,
      version: 1,
      expiresAt: at,
      lines: [
        {
          key: "card.swap.action",
          values: {
            sell: { type: "amount", amount: nativeAmount },
            buy: { type: "asset", asset: refs.token },
          },
        },
        {
          key: "card.route",
          values: {
            route: {
              type: "route",
              venue: "Fake Swap",
              legs: [{ venue: "fake-swap", shareBps: 10_000 }],
            },
            impact: { type: "percent", bps: 12 },
            slippage: { type: "percent", bps: 50 },
          },
        },
        { key: "card.expiry", values: { time: { type: "time", atMs: at } } },
      ],
      assets,
    },
  },
  "intent/list": {
    args: { cursor: "cursor-1", limit: 10, agent: ids.agent, state: "reconciled", kind: "swap" },
    result: pageOf(intentView),
  },
  "intent/confirm": {
    args: { intent: ids.intent, card: ids.card, cardVersion: 2 },
    result: intentView,
  },
  "intent/deny": { args: { intent: ids.intent, card: ids.card }, result: intentView },
  "intent/cancel": { args: { intent: ids.intent }, result: intentView },
};

/** An example call of every auto order, alert, webhook rule and schedule operation. */
export const orderExamples: { readonly [N in keyof OrderOperationShapes]: WireExample } = {
  "order/create": {
    args: trailingOrder,
    result: {
      ...orderView,
      state: "awaiting_confirmation",
      card: ids.card,
      intent: ids.intent,
      paper: true,
      outsideContent: false,
    },
  },
  "order/get": { args: { order: ids.order }, result: orderView },
  "order/list": {
    args: { agent: ids.agent, state: "active" },
    result: { items: [orderView], next: "cursor-2", assets },
  },
  "order/cancel": { args: { order: ids.order }, result: { ...orderView, state: "cancelled" } },
  "alert/create": {
    args: { agent: ids.agent, condition: alertCondition, wake: true },
    result: alertView,
  },
  "alert/list": { args: { agent: ids.agent, state: "fired" }, result: pageOf(alertView) },
  "alert/delete": { args: { alert: ids.alert }, result: empty },
  "webhookRule/create": {
    args: ruleRequest,
    result: { rule: ids.rule, url: "https://hooks.example.invalid/hook/whr/secret" },
  },
  "webhookRule/list": {
    args: empty,
    result: pageOf({
      rule: ids.rule,
      agent: ids.agent,
      state: "active",
      request: ruleRequest,
      fills: 0,
      createdAt: at,
      changedAt: at,
    }),
  },
  "webhookRule/delete": { args: { rule: ids.rule }, result: empty },
  "webhookRule/rotateUrl": {
    args: { rule: ids.rule },
    result: { url: "https://hooks.example.invalid/hook/whr/new" },
  },
  "schedule/create": {
    args: { agent: ids.agent, when: scheduleView.when, prompt: scheduleView.prompt },
    result: scheduleView,
  },
  "schedule/list": {
    args: empty,
    result: pageOf({ ...scheduleView, when: { at }, state: "ended" }),
  },
  "schedule/cancel": { args: { schedule: ids.schedule }, result: empty },
};
