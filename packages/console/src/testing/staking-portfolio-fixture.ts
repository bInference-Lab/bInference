import type { FakeAnswers } from "./fake-client";
import { fixture, portfolioAnswers } from "./portfolio-fixture";

// The staking portfolio `/positions` is tested on, as `portfolio/get` answers it for the agent:
// one unit of a validator's receipt token staked live, worth 1.05 BNB or $630, with half a BNB
// unbonding for 7 days and a tenth of a BNB to claim now; 0.45 units staked on paper, worth
// 0.4725 BNB or $283.50; and 50 USDT bridging to an account on Base, late. The receipt token's
// info is not in the answer, as with a token the registry does not list.

const { wallet, bnb, usdt } = fixture;
const whole = 10n ** 18n;
const receipt = "eip155:56/erc20:0x3333333333333333333333333333333333330001";
const validator = "eip155:56:0x2222222222222222222222222222222222220001";

// When the bridge left, and 7 days before the unbonding half is ready.
const sentAtMs = Date.UTC(2026, 9, 10, 9, 30, 0);

const stake = (mode: "live" | "paper", staked: bigint, worth: bigint) => ({
  wallet,
  venue: "stakehub",
  validator,
  staked: { asset: receipt, base: staked },
  stakedValue: { asset: bnb, base: worth },
  unbonding:
    mode === "live"
      ? [{ amount: { asset: bnb, base: whole / 2n }, readyAt: sentAtMs + 7 * 86_400_000 }]
      : [],
  claimable: { asset: bnb, base: mode === "live" ? whole / 10n : 0n },
  paper: mode === "paper",
});

// The receipt units of a stake as a balance of the wallet, with their dollars.
const units = (mode: "live" | "paper", base: bigint, usdMicros: bigint) => ({
  wallet,
  amount: { asset: receipt, base },
  usdMicros,
  paper: mode === "paper",
});

/** `portfolio/get` of the agent with its stakes and a bridge in transit. */
export const stakingPortfolioAnswer = {
  balances: [
    units("live", whole, 630_000_000n),
    units("paper", (whole * 45n) / 100n, 283_500_000n),
  ],
  positions: [],
  // $630 of receipt units, 0.6 BNB unbonding and to claim at $600, and $50 in transit.
  totalUsdMicros: 1_040_000_000n,
  paperTotalUsdMicros: 283_500_000n,
  assets: {
    [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
    [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
  },
  staking: [
    stake("live", whole, (whole * 105n) / 100n),
    stake("paper", (whole * 45n) / 100n, (whole * 4725n) / 10_000n),
  ],
  inTransit: [
    {
      intent: "int_0190f1c2-3a4b-7c5d-8e6f-0000000000c1",
      wallet,
      amount: { asset: usdt, base: 50n * whole },
      usdMicros: 50_000_000n,
      toChain: "eip155:8453",
      chainName: "Base",
      recipient: "eip155:8453:0x4444444444444444444444444444444444440001",
      sentAt: sentAtMs,
      late: true,
    },
  ],
};

/** A fake engine that answers the portfolio screen with the staking portfolio and no P&L card. */
export const stakingPortfolioAnswers: FakeAnswers = {
  ...portfolioAnswers,
  "portfolio/get": () => stakingPortfolioAnswer,
  "portfolio/pnl": () => ({ positions: [], realizedUsdMicros: 0n, cards: [], assets: {} }),
};
