import type { IntentOperationShapes } from "../operations/intent-operations.schema.js";
import type { MarketOperationShapes } from "../operations/market-operations.schema.js";
import type { OrderOperationShapes } from "../operations/order-operations.schema.js";
import {
  assets,
  at,
  ids,
  intentView,
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

const alertView = {
  alert: ids.alert,
  agent: ids.agent,
  condition: { kind: "price", asset: refs.token, direction: "below", price: "900000" },
  state: "fired",
  createdAt: at,
  firedAt: at + 1_000,
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
} as const;

/** An example call of every market read operation. */
export const marketExamples: { readonly [N in keyof MarketOperationShapes]: WireExample } = {
  "portfolio/get": { args: { agent: ids.agent }, result: portfolioView },
  "portfolio/pnl": {
    args: { agent: ids.agent, from: at, to: at + 86_400_000 },
    result: {
      positions: [{ asset: refs.token, realizedUsdMicros: "-3000000" }],
      realizedUsdMicros: "-3000000",
      unrealizedUsdMicros: "1250000",
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
};

/** An example call of every intent operation. */
export const intentExamples: { readonly [N in keyof IntentOperationShapes]: WireExample } = {
  "intent/propose": { args: swapRequest, result: intentView },
  "intent/get": { args: { intent: ids.intent }, result: intentView },
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
    result: { ...orderView, state: "awaiting_confirmation", card: ids.card },
  },
  "order/get": { args: { order: ids.order }, result: orderView },
  "order/list": { args: { agent: ids.agent, state: "active" }, result: pageOf(orderView) },
  "order/cancel": { args: { order: ids.order }, result: { ...orderView, state: "cancelled" } },
  "alert/create": {
    args: { agent: ids.agent, condition: alertView.condition },
    result: alertView,
  },
  "alert/list": { args: empty, result: pageOf(alertView) },
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
  "schedule/list": { args: empty, result: pageOf({ ...scheduleView, when: { at } }) },
  "schedule/cancel": { args: { schedule: ids.schedule }, result: empty },
};
