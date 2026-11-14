import type { FakeAnswers } from "./fake-client";

// The auto orders and alerts of one agent, as `order/list`, `order/get` and `alert/list` answer
// them: a live trailing stop its agent's freeze paused, a paper stop-loss that is active, a paper
// limit buy whose card waits, and one paper order that ended in each way; and a price, a wallet
// and a launch alert.

const id = (prefix: string, n: number): string =>
  `${prefix}_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`;

/** The fixture's agent, orders, intents, alerts and assets. */
export const orderFixture = {
  agent: id("agt", 1),
  paused: id("ord", 1),
  active: id("ord", 2),
  waiting: id("ord", 3),
  waitingIntent: id("int", 3),
  card: id("crd", 3),
  priceAlert: id("alr", 1),
  walletAlert: id("alr", 2),
  launchAlert: id("alr", 3),
  bnb: "eip155:56/slip44:714",
  cake: "eip155:56/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  leader: "eip155:56:0x00000000000000000000000000000000000000d1",
} as const;

const { agent, cake, bnb } = orderFixture;
const at = 1_800_000_000_000;
const day = 86_400_000;
const minute = 60_000;

const assets = {
  [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
  [cake]: { symbol: "CAKE", name: "PancakeSwap Token", decimals: 18, verified: true },
};

const agentView = {
  agent,
  name: "main",
  mode: "paper",
  locale: "en",
  createdAt: at,
  changedAt: at,
};

const sellAll = { percentBps: 10_000 };

// What an order asks beside its agent, token, side and size, which it keeps unless it names them.
type RequestFields = Readonly<Record<string, string | object>> & { readonly kind: string };

// A paper order of the fixture's agent selling all its CAKE, in the state given.
function orderOf(n: number, state: string, request: RequestFields) {
  return {
    order: id("ord", n),
    agent,
    wallet: id("wal", 1),
    kind: request.kind,
    state,
    request: { agent, token: cake, side: "sell", size: sellAll, ...request },
    fills: state === "filled" ? 1 : 0,
    maxFills: 1,
    expiresAt: at + 30 * day,
    intent: id("int", n),
    paper: true,
    createdAt: at,
    changedAt: at + n * minute,
  };
}

const stopLoss = { kind: "stopLoss", trigger: { price: 1_800_000n } };

/** Every order of the fixture, by state. */
const orders = [
  { ...orderOf(1, "paused", { kind: "trailing", trigger: { distanceBps: 500 } }), paper: false },
  orderOf(2, "active", stopLoss),
  orderOf(3, "awaiting_confirmation", {
    kind: "limit",
    side: "buy",
    size: { usdMicros: 20_000_000n },
    trigger: { price: 1_500_000n, direction: "below" },
  }),
  orderOf(4, "filled", { kind: "takeProfit", trigger: { price: 3_000_000n } }),
  orderOf(5, "cancelled", {
    kind: "dca",
    side: "buy",
    size: { usdMicros: 10_000_000n },
    trigger: { cron: "0 9 * * 1" },
  }),
  orderOf(6, "expired", {
    kind: "copy",
    token: bnb,
    side: "buy",
    size: { usdMicros: 20_000_000n },
    trigger: { leader: orderFixture.leader, perBuyUsdMicros: 20_000_000n },
  }),
  { ...orderOf(7, "ended", stopLoss), endReason: "position_closed" },
];

/** `order/get` of the active stop-loss: a fill, then skips, the newest first, and older ones. */
const activeWithFills = {
  ...orders[1],
  fillHistory: [
    {
      fill: id("fil", 4),
      outcome: "skipped",
      reason: "copy_daily_cap",
      reasonValues: { used: "$40.00", cap: "$40.00" },
      at: at + 4 * minute,
    },
    { fill: id("fil", 3), outcome: "skipped", reason: "daily_cap", at: at + 3 * minute },
    { fill: id("fil", 2), outcome: "skipped", reason: "late", at: at + 2 * minute },
    { fill: id("fil", 1), outcome: "filled", intent: id("int", 9), at: at + minute },
  ],
  fillHistoryMore: true,
};

const pendingIntent = {
  intent: orderFixture.waitingIntent,
  agent,
  kind: "autoOrder",
  paper: true,
  card: {
    card: orderFixture.card,
    version: 1,
    opensAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  },
};

const cardLines = {
  card: orderFixture.card,
  version: 1,
  expiresAt: Date.now() + 600_000,
  assets,
  lines: [
    {
      key: "card.order.condition",
      values: {
        direction: { type: "choice", choice: "below" },
        price: { type: "usd", usdMicros: 1_500_000n },
      },
    },
  ],
};

const alerts = [
  {
    alert: orderFixture.priceAlert,
    agent,
    condition: { kind: "price", asset: cake, direction: "above", price: 3_000_000n },
    state: "active",
    wake: true,
    fires: 0,
    createdAt: at,
  },
  {
    alert: orderFixture.walletAlert,
    agent,
    condition: {
      kind: "wallet",
      account: orderFixture.leader,
      side: "buy",
      minUsdMicros: 100_000_000n,
    },
    state: "active",
    wake: false,
    fires: 2,
    createdAt: at,
    firedAt: at + minute,
    expiresAt: at + 30 * day,
  },
  {
    alert: orderFixture.launchAlert,
    agent,
    condition: { kind: "launch", filters: {} },
    state: "active",
    wake: false,
    fires: 1,
    createdAt: at,
  },
];

/** A fake engine that holds the fixture's agent, orders, card and alerts, and cancels or deletes. */
export const orderAnswers: FakeAnswers = {
  "agent/list": () => ({ items: [agentView] }),
  "order/list": (args) => ({
    items: orders.filter(({ state }) => "state" in args && args.state === state),
    assets,
  }),
  "order/get": () => activeWithFills,
  "order/cancel": (args) => ({
    ...orders[1],
    ...("order" in args ? {} : {}),
    state: "cancelled",
    changedAt: at + 10 * minute,
  }),
  "intent/list": () => ({ items: [pendingIntent] }),
  "intent/card": () => cardLines,
  "alert/list": () => ({ items: alerts }),
  "asset/get": () => ({ asset: cake, ...assets[cake] }),
  "alert/delete": () => ({}),
};
