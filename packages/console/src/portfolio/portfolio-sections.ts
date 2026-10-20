import type { BalanceView, PnlCardView, PortfolioView, ProtocolId } from "@binference/protocol";

// Live or paper: the two parts of a portfolio, which are never added together.
type HoldingMode = "live" | "paper";

/** One wallet's balances in one mode, in the order the portfolio lists them. */
export interface WalletHoldings {
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
  readonly open: readonly PnlCardView[];
  readonly closed: readonly PnlCardView[];
}

const modes: readonly HoldingMode[] = ["live", "paper"];

function walletsOf(balances: readonly BalanceView[]): readonly WalletHoldings[] {
  const wallets = [...new Set(balances.map(({ wallet }) => wallet))];
  return wallets.map((wallet) => ({
    wallet,
    balances: balances.filter((balance) => balance.wallet === wallet),
  }));
}

function sectionOf(
  mode: HoldingMode,
  view: PortfolioView,
  cards: readonly PnlCardView[],
): HoldingSection {
  const isPaper = mode === "paper";
  const balances = view.balances.filter(({ paper }) => paper === isPaper);
  const own = cards.filter(({ paper }) => paper === isPaper);
  return {
    mode,
    wallets: walletsOf(balances),
    totalUsdMicros: (isPaper ? view.paperTotalUsdMicros : view.totalUsdMicros) ?? 0n,
    hasUnpriced: balances.some(({ usdMicros }) => usdMicros === undefined),
    open: own.filter(({ closed }) => !closed),
    closed: own.filter(({ closed }) => closed),
  };
}

/**
 * An agent's portfolio and P&L cards split into a live section and a paper section, live first,
 * each with its own total and never one sum of both (decision 0134). A mode with no balance and
 * no card has no section. The cards keep the engine's order.
 */
export function holdingSections(
  view: PortfolioView,
  cards: readonly PnlCardView[],
): readonly HoldingSection[] {
  return modes
    .map((mode) => sectionOf(mode, view, cards))
    .filter(
      (section) => section.wallets.length > 0 || section.open.length + section.closed.length > 0,
    );
}
