import { stakeLines, transitLine } from "@binference/i18n";
import type {
  BalanceView,
  CardLineView,
  PnlCardView,
  PortfolioView,
  ProtocolId,
} from "@binference/protocol";

// Live or paper: the two parts of a portfolio, which are never added together.
type HoldingMode = "live" | "paper";

/** One wallet's balances in one mode, in the order the portfolio lists them. */
export interface WalletHoldings {
  readonly wallet: ProtocolId<"wallet">;
  readonly balances: readonly BalanceView[];
}

/** A stake or a bridge in transit as its lines, keyed by what it is. */
export interface HeldItem {
  readonly key: string;
  readonly lines: readonly CardLineView[];
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
  /** Each stake's lines (decision 0329): its worth, its unbonding parts and what a claim takes. */
  readonly stakes: readonly HeldItem[];
  /** Each bridge in transit's line; bridges are live only, so a paper section has none. */
  readonly transits: readonly HeldItem[];
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
  const stakes = (view.staking ?? [])
    .filter(({ paper }) => paper === isPaper)
    .map((stake) => ({
      key: [stake.wallet, stake.venue, stake.validator ?? ""].join(" "),
      lines: stakeLines(view, stake),
    }))
    .filter(({ lines }) => lines.length > 0);
  // A chain an older engine names by reference alone shows as that reference.
  const transits = isPaper
    ? []
    : (view.inTransit ?? []).map((transit) => ({
        key: transit.intent,
        lines: [transitLine(view, transit, transit.chainName ?? transit.toChain)],
      }));
  return {
    mode,
    wallets: walletsOf(balances),
    totalUsdMicros: (isPaper ? view.paperTotalUsdMicros : view.totalUsdMicros) ?? 0n,
    hasUnpriced: balances.some(({ usdMicros }) => usdMicros === undefined),
    open: own.filter(({ closed }) => !closed),
    closed: own.filter(({ closed }) => closed),
    stakes,
    transits,
  };
}

function holdsAnything(section: HoldingSection): boolean {
  const { wallets, open, closed, stakes, transits } = section;
  return [wallets, open, closed, stakes, transits].some((part) => part.length > 0);
}

/**
 * An agent's portfolio and P&L cards split into a live section and a paper section, live first,
 * each with its own total and never one sum of both (decision 0134), with its stakes and, live
 * only, its bridges in transit, in the words `/positions` uses. A mode that holds nothing has no
 * section. The cards, stakes and bridges keep the engine's order.
 */
export function holdingSections(
  view: PortfolioView,
  cards: readonly PnlCardView[],
): readonly HoldingSection[] {
  return modes.map((mode) => sectionOf(mode, view, cards)).filter(holdsAnything);
}
