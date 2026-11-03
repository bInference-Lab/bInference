import type { ReplyRewrites } from "./rewrite-replies";
import { type PortfolioAnswer, readPortfolio } from "./smoke-frames.schema";

// The smoke engine trades on paper and runs no staking venue or bridge, so the smoke test adds the
// staking portfolio the unit tests read to each `portfolio/get` answer: one unit of a validator's
// receipt token staked live, worth 1.05 coins, half a coin unbonding and a tenth to claim; 0.45
// units staked on paper; 50 TKN bridging to Base, late.

const coin = "fake:1/slip44:1";
const token = "fake:1/token:0x0000000a";
const receipt = "fake:1/token:0x3333333333333333333333333333333333330001";
const validator = "fake:1:0x2222222222222222222222222222222222220001";
const whole = 10n ** 18n;
const sentAt = Date.UTC(2026, 9, 10, 9, 30, 0);

type Mode = "live" | "paper";

interface Held {
  readonly mode: Mode;
  readonly staked: bigint;
  readonly worth: bigint;
}

const base = (units: bigint): string => units.toString();

function stakeOf(wallet: string, held: Held) {
  const isLive = held.mode === "live";
  return {
    wallet,
    venue: "stakehub",
    validator,
    staked: { asset: receipt, base: base(held.staked) },
    stakedValue: { asset: coin, base: base(held.worth) },
    unbonding: isLive
      ? [{ amount: { asset: coin, base: base(whole / 2n) }, readyAt: sentAt + 7 * 86_400_000 }]
      : [],
    claimable: { asset: coin, base: base(isLive ? whole / 10n : 0n) },
    paper: !isLive,
  };
}

// The answer with the stakes and the bridge, their receipt units as balances, and the totals they
// add to: $630 of live units, 0.6 coins unbonding and to claim at $600, $50 in transit, and $283.50
// of paper units.
function withHeld(answer: PortfolioAnswer): PortfolioAnswer {
  const wallet = answer.balances[0]?.wallet ?? "";
  const live: Held = { mode: "live", staked: whole, worth: (whole * 105n) / 100n };
  const paper: Held = {
    mode: "paper",
    staked: (whole * 45n) / 100n,
    worth: (whole * 4725n) / 10_000n,
  };
  const units = (held: Held, usdMicros: string) => ({
    wallet,
    amount: { asset: receipt, base: base(held.staked) },
    usdMicros,
    paper: held.mode === "paper",
  });
  return {
    ...answer,
    balances: [units(live, "630000000"), ...answer.balances, units(paper, "283500000")],
    totalUsdMicros: base(BigInt(answer.totalUsdMicros) + 1_040_000_000n),
    paperTotalUsdMicros: base(BigInt(answer.paperTotalUsdMicros ?? "0") + 283_500_000n),
    assets: {
      ...answer.assets,
      [receipt]: { symbol: "stFAKE", name: "Staked FAKE", decimals: 18, verified: true },
    },
    staking: [stakeOf(wallet, live), stakeOf(wallet, paper)],
    inTransit: [
      {
        intent: "int_0190f1c2-3a4b-7c5d-8e6f-0000000000c1",
        wallet,
        amount: { asset: token, base: base(50_000_000n) },
        usdMicros: "50000000",
        toChain: "eip155:8453",
        chainName: "Base",
        recipient: "eip155:8453:0x4444444444444444444444444444444444440001",
        sentAt,
        late: true,
      },
    ],
  };
}

/** Adds the staking portfolio to every `portfolio/get` answer. */
export const heldElsewhere: ReplyRewrites = {
  "portfolio/get": (result) => withHeld(readPortfolio(result)),
};
