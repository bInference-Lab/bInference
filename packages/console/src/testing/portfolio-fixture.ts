// An agent's live and paper holdings in one wallet, as `portfolio/get` answers them: BNB and
// USDT priced, and a token nothing knows without a price. The live total and the paper total are
// the engine's, each over its own priced balances.

// The fixture's agent, wallet and assets.
const fixture = {
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  bnb: "eip155:56/slip44:714",
  usdt: "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955",
  unknown: "eip155:56/erc20:0xabababababababababababababababababababab",
} as const;

const { wallet, bnb, usdt, unknown } = fixture;
const unit = 10n ** 18n;

const assets = {
  [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
  [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
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
