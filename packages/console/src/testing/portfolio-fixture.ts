import type { FakeAnswers } from "./fake-client";

// An agent with live and paper holdings in one wallet, as `portfolio/get` and `portfolio/pnl` with
// `cards: true` answer them: BNB and USDT priced, a token nothing knows without a price, an open
// and a closed live position, and an open paper one. The live total and the paper total are the
// engine's, each over its own priced balances.

/** The fixture's agent, wallet and assets. */
export const fixture = {
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  bnb: "eip155:56/slip44:714",
  usdt: "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955",
  unknown: "eip155:56/erc20:0xabababababababababababababababababababab",
  cake: "eip155:56/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
} as const;

const { agent, wallet, bnb, usdt, unknown, cake } = fixture;
const unit = 10n ** 18n;

const assets = {
  [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
  [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
  [cake]: { symbol: "CAKE", name: "PancakeSwap Token", decimals: 18, verified: true },
};

// The fixture's agent, live.
const agentView = {
  agent,
  name: "main",
  mode: "live",
  locale: "en",
  createdAt: 1_790_000_000_000,
  changedAt: 1_790_000_000_000,
};

const walletView = {
  wallet,
  agent,
  address: "eip155:56:0x1111111111111111111111111111111111112222",
  label: "trading",
  createdAt: 1_790_000_000_000,
};

interface Held {
  readonly asset: string;
  readonly base: bigint;
  readonly usdMicros?: bigint;
}

const balance = (mode: "live" | "paper", { asset, base, usdMicros }: Held) => ({
  wallet,
  amount: { asset, base },
  paper: mode === "paper",
  ...(usdMicros === undefined ? {} : { usdMicros }),
});

/** `portfolio/get` of the agent. */
export const portfolioAnswer = {
  balances: [
    balance("live", { asset: usdt, base: 1205n * 10n ** 17n, usdMicros: 120_500_000n }),
    balance("live", { asset: unknown, base: 42_000n }),
    balance("live", { asset: bnb, base: unit / 2n, usdMicros: 300_000_000n }),
    balance("paper", { asset: bnb, base: unit, usdMicros: 600_000_000n }),
    balance("paper", { asset: usdt, base: 500n * unit, usdMicros: 500_000_000n }),
  ],
  positions: [],
  totalUsdMicros: 420_500_000n,
  paperTotalUsdMicros: 1_100_000_000n,
  assets,
};

const usd = (usdMicros: bigint) => ({ type: "usd", usdMicros });
const change = (usdMicros: bigint) => ({ type: "usdChange", usdMicros });
const header = (key: string, token: object, mode: "live" | "paper") => ({
  key,
  values: { token, agent: { type: "text", text: "main" }, mode: { type: "choice", choice: mode } },
});
const fees = { key: "pnl.fees", values: { venue: usd(1_500_000n), network: usd(80_000n) } };
const since = {
  key: "pnl.since",
  values: { openedAt: { type: "dateTime", atMs: 1_791_000_000_000 } },
};

const openCard = (mode: "live" | "paper", quantity: bigint, value: bigint) => ({
  asset: bnb,
  paper: mode === "paper",
  closed: false,
  lines: [
    header("pnl.header", { type: "asset", asset: bnb }, mode),
    {
      key: "pnl.holding",
      values: {
        amount: { type: "amount", amount: { asset: bnb, base: quantity } },
        value: usd(value),
      },
    },
    { key: "pnl.cost", values: { average: usd(550_000_000n), cost: usd((value * 11n) / 12n) } },
    {
      key: "pnl.open",
      values: {
        unrealized: change(value / 12n),
        percent: { type: "percentChange", bps: 909n },
        realized: change(0n),
      },
    },
    fees,
    since,
  ],
});

const closedCard = {
  asset: cake,
  paper: false,
  closed: true,
  lines: [
    header("pnl.headerClosed", { type: "asset", asset: cake }, "live"),
    { key: "pnl.trades", values: { bought: usd(200_000_000n), sold: usd(180_000_000n) } },
    {
      key: "pnl.closed",
      values: { realized: change(-20_000_000n), percent: { type: "percentChange", bps: -1000n } },
    },
    fees,
    {
      key: "pnl.held",
      values: {
        openedAt: { type: "dateTime", atMs: 1_791_000_000_000 },
        closedAt: { type: "dateTime", atMs: 1_791_172_800_000 },
        duration: {
          type: "line",
          line: { key: "pnl.days", values: { count: { type: "count", count: 2 } } },
        },
      },
    },
  ],
};

/** `portfolio/pnl` of the agent with `cards: true`: live before paper, open before closed. */
export const pnlAnswer = {
  positions: [],
  realizedUsdMicros: -20_000_000n,
  paperPositions: [],
  paperRealizedUsdMicros: 0n,
  cards: [
    openCard("live", unit / 2n, 300_000_000n),
    closedCard,
    openCard("paper", unit, 600_000_000n),
  ],
  assets,
};

/** A fake engine that answers the portfolio screen's calls with the fixture. */
export const portfolioAnswers: FakeAnswers = {
  "agent/list": () => ({ items: [agentView] }),
  "wallet/list": () => ({ items: [walletView] }),
  "portfolio/get": () => portfolioAnswer,
  "portfolio/pnl": () => pnlAnswer,
};
