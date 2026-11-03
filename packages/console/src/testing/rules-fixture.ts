import type { FakeAnswers } from "./fake-client";

// Two alert rules of one paper agent, as `webhookRule/list` answers them: one active that buys
// CAKE with $20 on each alert, and one whose card waits, with its card and the alerts the first
// one's URL took.

/** The fixture's agent, rules, intents and assets. */
export const ruleFixture = {
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  active: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  waiting: "whr_0190f1c2-3a4b-7c5d-8e6f-000000000002",
  waitingIntent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000002",
  card: "crd_0190f1c2-3a4b-7c5d-8e6f-000000000002",
  bnb: "eip155:56/slip44:714",
  cake: "eip155:56/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  url: "https://owner.example.invalid:8443/hook/whr_0190f1c2-3a4b-7c5d-8e6f-000000000003/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  rotatedUrl:
    "https://owner.example.invalid:8443/hook/whr_0190f1c2-3a4b-7c5d-8e6f-000000000001/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
} as const;

const { agent, active, waiting, waitingIntent, card, bnb, cake } = ruleFixture;
const at = 1_800_000_000_000;
const day = 86_400_000;

const agentView = {
  agent,
  name: "main",
  mode: "paper",
  locale: "en",
  createdAt: at,
  changedAt: at,
  defaultWallet: {
    wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    agent,
    address: "eip155:56:0x1111111111111111111111111111111111112222",
    label: "trading",
    createdAt: at,
  },
};

const assets = {
  [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
  [cake]: { symbol: "CAKE", name: "PancakeSwap Token", decimals: 18, verified: true },
};

const buyCake = (usdMicros: bigint) => ({
  key: "card.webhookRule.buy",
  values: {
    token: { type: "asset", asset: cake },
    spend: {
      type: "line",
      line: {
        key: "card.order.spend",
        values: {
          size: { type: "choice", choice: "usd" },
          usd: { type: "usd", usdMicros },
          asset: { type: "asset", asset: bnb },
        },
      },
    },
  },
});

const rule = (id: string, state: string, name: string) => ({
  rule: id,
  agent,
  state,
  request: {
    agent,
    name,
    token: cake,
    side: "buy",
    size: { usdMicros: 20_000_000n },
    ratePerMinute: 5,
    maxFills: 10,
    expiresAt: at + 30 * day,
  },
  fills: 2,
  createdAt: at,
  changedAt: at,
  ratePerMinute: 5,
  summary: buyCake(20_000_000n),
});

/** `webhookRule/list`: the active rule, then the one whose card waits. */
const rulesAnswer = {
  items: [
    { ...rule(active, "active", "CAKE breakout"), lastAlertAt: at + 60_000 },
    { ...rule(waiting, "awaiting_confirmation", "CAKE dip"), fills: 0, intent: waitingIntent },
  ],
  assets,
};

const pendingIntent = {
  intent: waitingIntent,
  agent,
  kind: "webhookRule",
  paper: true,
  card: { card, version: 1, opensAt: Date.now(), expiresAt: Date.now() + 600_000 },
};

const cardLines = {
  card,
  version: 1,
  expiresAt: Date.now() + 600_000,
  assets,
  lines: [
    {
      key: "card.webhookRule.action",
      values: {
        name: { type: "text", text: "CAKE dip" },
        summary: { type: "line", line: buyCake(20_000_000n) },
        rate: { type: "count", count: 5 },
      },
    },
    { key: "card.webhookRule.url", values: {} },
  ],
};

/** `webhookRule/events` of the active rule: a fill, a skip, a repeat and one over its rate. */
const eventsAnswer = {
  items: [
    { event: 4, receivedAt: at + 60_000, taken: "rate", alertId: "breakout-4" },
    { event: 3, receivedAt: at + 50_000, taken: "repeat" },
    { event: 2, receivedAt: at + 40_000, taken: "accepted", fill: "skipped", reason: "late" },
    { event: 1, receivedAt: at + 30_000, taken: "accepted", fill: "filled", alertId: "breakout-1" },
  ],
};

/** A fake engine that holds the fixture's agent, rules and card, and makes a rule from CAKE. */
export const ruleAnswers: FakeAnswers = {
  "agent/list": () => ({ items: [agentView] }),
  "webhookRule/list": () => rulesAnswer,
  "webhookRule/events": () => eventsAnswer,
  "intent/list": () => ({ items: [pendingIntent] }),
  "intent/card": () => cardLines,
  "asset/search": (args) =>
    "query" in args && args.query === "CAKE"
      ? { items: [{ asset: cake, ...assets[cake] }] }
      : { items: [] },
  "webhookRule/create": () => ({ rule: active, url: ruleFixture.url }),
  "webhookRule/rotateUrl": () => ({ url: ruleFixture.rotatedUrl }),
  "webhookRule/delete": () => ({}),
};
