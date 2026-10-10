import type { Amount, ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import type { BalanceView, PortfolioView, PositionView } from "@binference/protocol";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { ValuedPosition } from "../positions/create-positions.js";

/** What a wallet holds now of one asset, with its value when a price is known. */
export interface HeldBalance {
  readonly amount: Amount;
  readonly usdMicros?: bigint;
}

/** One wallet's holdings in one mode: its balances now and its positions, valued. */
export interface WalletHoldings {
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  readonly balances: readonly HeldBalance[];
  readonly positions: readonly ValuedPosition[];
}

/** A paper portfolio's holdings: each paper position that holds units is a balance. */
export function paperHoldingsOf(
  walletId: Id<"wal">,
  valued: readonly ValuedPosition[],
): WalletHoldings {
  const balances = valued.map(({ position, valueUsdMicros }) => ({
    amount: { asset: position.asset, base: position.quantityBase },
    ...(valueUsdMicros === undefined ? {} : { usdMicros: valueUsdMicros }),
  }));
  return { walletId, isPaper: true, balances, positions: valued };
}

function positionOf(
  { position, unrealizedUsdMicros }: ValuedPosition,
  holdings: WalletHoldings,
): PositionView {
  return {
    wallet: position.walletId,
    asset: position.asset,
    quantity: position.quantityBase,
    costUsdMicros: position.costUsdMicros,
    realizedUsdMicros: position.realizedUsdMicros,
    ...(unrealizedUsdMicros === undefined ? {} : { unrealizedUsdMicros }),
    paper: holdings.isPaper,
  };
}

function balanceOf({ amount, usdMicros }: HeldBalance, holdings: WalletHoldings): BalanceView {
  return {
    wallet: holdings.walletId,
    amount,
    ...(usdMicros === undefined ? {} : { usdMicros }),
    paper: holdings.isPaper,
  };
}

interface WalletViews {
  readonly balances: readonly BalanceView[];
  readonly positions: readonly PositionView[];
}

function viewsOf(holdings: WalletHoldings): WalletViews {
  const balances = holdings.balances
    .filter(({ amount }) => amount.base > 0n)
    .map((held) => balanceOf(held, holdings));
  const positions = holdings.positions
    .filter(({ position }) => position.quantityBase > 0n || position.realizedUsdMicros !== 0n)
    .map((valued) => positionOf(valued, holdings));
  return { balances, positions };
}

const totalOf = (balances: readonly BalanceView[]): bigint =>
  balances.reduce((total, balance) => total + (balance.usdMicros ?? 0n), 0n);

/**
 * A portfolio as the protocol shows it (protocol spec, section 7.3): every live holding first,
 * then every paper one, wallet by wallet in the order given. A balance of nothing, and a position
 * that holds nothing and realized nothing, are left out. The live balances with a known price add
 * up to the total, the paper ones to a paper total of their own, and the two are never added
 * together.
 */
export function portfolioViewOf(
  holdings: readonly WalletHoldings[],
  chains: ChainRegistry,
): PortfolioView {
  const ordered = [
    ...holdings.filter((held) => !held.isPaper),
    ...holdings.filter((held) => held.isPaper),
  ];
  const views = ordered.map(viewsOf);
  const balances = views.flatMap((view) => view.balances);
  const positions = views.flatMap((view) => view.positions);
  const paper = balances.filter((balance) => balance.paper);
  const assets = [
    ...new Set([
      ...balances.map(({ amount }) => amount.asset),
      ...positions.map(({ asset }) => asset),
    ]),
  ];
  return {
    balances,
    positions,
    totalUsdMicros: totalOf(balances.filter((balance) => !balance.paper)),
    ...(paper.length === 0 ? {} : { paperTotalUsdMicros: totalOf(paper) }),
    assets: assetInfosOf(chains, assets),
  };
}
