import type { ChainRegistry } from "@binference/chain";
import type { BalanceView, PortfolioView, PositionView } from "@binference/protocol";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { ValuedPosition } from "../positions/create-positions.js";

function balanceOf({ position, valueUsdMicros }: ValuedPosition): BalanceView {
  return {
    wallet: position.walletId,
    amount: { asset: position.asset, base: position.quantityBase },
    ...(valueUsdMicros === undefined ? {} : { usdMicros: valueUsdMicros }),
    paper: true,
  };
}

function positionOf({ position, unrealizedUsdMicros }: ValuedPosition): PositionView {
  return {
    wallet: position.walletId,
    asset: position.asset,
    quantity: position.quantityBase,
    costUsdMicros: position.costUsdMicros,
    realizedUsdMicros: position.realizedUsdMicros,
    ...(unrealizedUsdMicros === undefined ? {} : { unrealizedUsdMicros }),
    paper: true,
  };
}

/**
 * A paper portfolio as the protocol shows it (protocol spec, section 7.3): each position that
 * holds units as a balance with its value now, the positions with their P&L, and the total of the
 * balances with a known price. A position that holds nothing and realized nothing is left out.
 */
export function paperPortfolioViewOf(
  valued: readonly ValuedPosition[],
  chains: ChainRegistry,
): PortfolioView {
  const shown = valued.filter(
    ({ position }) => position.quantityBase > 0n || position.realizedUsdMicros !== 0n,
  );
  const balances = shown.filter(({ position }) => position.quantityBase > 0n).map(balanceOf);
  return {
    balances,
    positions: shown.map(positionOf),
    totalUsdMicros: balances.reduce((total, balance) => total + (balance.usdMicros ?? 0n), 0n),
    assets: assetInfosOf(chains, [...new Set(shown.map(({ position }) => position.asset))]),
  };
}
