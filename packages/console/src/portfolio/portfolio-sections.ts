import type { BalanceView, PortfolioView, ProtocolId } from "@binference/protocol";

// Live or paper: the two parts of a portfolio, which are never added together.
type HoldingMode = "live" | "paper";

// One wallet's balances in one mode, in the order the portfolio lists them.
interface WalletHoldings {
  readonly wallet: ProtocolId<"wallet">;
  readonly balances: readonly BalanceView[];
}

/** One mode's part of an agent's portfolio, as the screen shows it in its own section. */
export interface HoldingSection {
  readonly mode: HoldingMode;
  readonly wallets: readonly WalletHoldings[];
  /** The engine's total of this mode's balances with a known price. */
  readonly totalUsdMicros: bigint;
  /** Some balance has no price now, so the total leaves it out. */
  readonly hasUnpriced: boolean;
}

const modes: readonly HoldingMode[] = ["live", "paper"];

function walletsOf(balances: readonly BalanceView[]): readonly WalletHoldings[] {
  const wallets = [...new Set(balances.map(({ wallet }) => wallet))];
  return wallets.map((wallet) => ({
    wallet,
    balances: balances.filter((balance) => balance.wallet === wallet),
  }));
}

function sectionOf(mode: HoldingMode, view: PortfolioView): HoldingSection {
  const isPaper = mode === "paper";
  const balances = view.balances.filter(({ paper }) => paper === isPaper);
  return {
    mode,
    wallets: walletsOf(balances),
    totalUsdMicros: (isPaper ? view.paperTotalUsdMicros : view.totalUsdMicros) ?? 0n,
    hasUnpriced: balances.some(({ usdMicros }) => usdMicros === undefined),
  };
}

/**
 * An agent's portfolio split into a live section and a paper section, live first, each with its
 * own total and never one sum of both (decision 0134). A mode with no balance has no section.
 */
export function holdingSections(view: PortfolioView): readonly HoldingSection[] {
  return modes.map((mode) => sectionOf(mode, view)).filter((section) => section.wallets.length > 0);
}
