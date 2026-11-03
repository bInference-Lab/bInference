import type { Amount, ChainRegistry } from "@binference/chain";
import type { Id } from "@binference/core";
import type { BalanceView, PortfolioView, PositionView } from "@binference/protocol";
import type { TransitHolding } from "../bridges/bridges-in-transit.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { ValuedPosition } from "../positions/create-positions.js";
import type { StakeHolding } from "./stake-holdings.js";

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

/** What a portfolio holds beside its wallets' balances: stakes, and bridges in transit. */
export interface HeldElsewhere {
  readonly staking?: readonly StakeHolding[];
  readonly inTransit?: readonly TransitHolding[];
}

type StakingView = NonNullable<PortfolioView["staking"]>[number];
type InTransitView = NonNullable<PortfolioView["inTransit"]>[number];

function stakingViewOf(held: StakeHolding): StakingView {
  const { stakedValue } = held;
  return {
    wallet: held.walletId,
    venue: held.venue,
    validator: held.validator,
    ...(held.staked === undefined ? {} : { staked: held.staked }),
    ...(stakedValue === undefined ? {} : { stakedValue }),
    unbonding: held.unbonding.map(({ amount, readyAtMs }) => ({ amount, readyAt: readyAtMs })),
    claimable: held.claimable,
    paper: held.isPaper,
  };
}

function inTransitViewOf(held: TransitHolding): InTransitView {
  const { usdMicros, chainName } = held;
  return {
    intent: held.intentId,
    wallet: held.walletId,
    amount: held.amount,
    ...(usdMicros === undefined ? {} : { usdMicros }),
    toChain: held.toChain,
    ...(chainName === undefined ? {} : { chainName }),
    recipient: held.recipient,
    sentAt: held.sentAtMs,
    late: held.late,
  };
}

const sumOf = (values: readonly (bigint | undefined)[]): bigint =>
  values.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);

// The assets the stakes and the bridges in transit name.
function elsewhereAssets(staking: readonly StakeHolding[], inTransit: readonly TransitHolding[]) {
  return [
    ...staking.flatMap((held) => [
      ...(held.staked === undefined ? [] : [held.staked.asset]),
      held.claimable.asset,
      ...held.unbonding.map(({ amount }) => amount.asset),
    ]),
    ...inTransit.map(({ amount }) => amount.asset),
  ];
}

/**
 * A portfolio as the protocol shows it (protocol spec, section 7.3): every live holding first,
 * then every paper one, wallet by wallet in the order given, then the stakes, live first, and the
 * bridges in transit. A balance of nothing, and a position that holds nothing and realized
 * nothing, are left out. Each dollar counts once (decision 0329): the live balances with a known
 * price, the live unbonding coin with one and the bridges in transit with a value add up to the
 * total; the paper balances and unbonding coin to a paper total of their own, and the two are never
 * added together. A stake's receipt units count as their balance, never again as the stake.
 */
export function portfolioViewOf(
  holdings: readonly WalletHoldings[],
  chains: ChainRegistry,
  elsewhere: HeldElsewhere = {},
): PortfolioView {
  const ordered = [
    ...holdings.filter((held) => !held.isPaper),
    ...holdings.filter((held) => held.isPaper),
  ];
  const views = ordered.map(viewsOf);
  const balances = views.flatMap((view) => view.balances);
  const positions = views.flatMap((view) => view.positions);
  const paper = balances.filter((balance) => balance.paper);
  const { inTransit = [] } = elsewhere;
  const staking = [
    ...(elsewhere.staking ?? []).filter((held) => !held.isPaper),
    ...(elsewhere.staking ?? []).filter((held) => held.isPaper),
  ];
  const liveWaiting = sumOf(
    staking.filter((held) => !held.isPaper).map((held) => held.waitingUsdMicros),
  );
  const paperWaiting = sumOf(
    staking.filter((held) => held.isPaper).map((held) => held.waitingUsdMicros),
  );
  const hasPaper = paper.length > 0 || staking.some((held) => held.isPaper);
  const assets = [
    ...new Set([
      ...balances.map(({ amount }) => amount.asset),
      ...positions.map(({ asset }) => asset),
      ...elsewhereAssets(staking, inTransit),
    ]),
  ];
  const live = totalOf(balances.filter((balance) => !balance.paper));
  return {
    balances,
    positions,
    totalUsdMicros: live + liveWaiting + sumOf(inTransit.map(({ usdMicros }) => usdMicros)),
    ...(hasPaper ? { paperTotalUsdMicros: totalOf(paper) + paperWaiting } : {}),
    assets: assetInfosOf(chains, assets),
    ...(staking.length === 0 ? {} : { staking: staking.map(stakingViewOf) }),
    ...(inTransit.length === 0 ? {} : { inTransit: inTransit.map(inTransitViewOf) }),
  };
}
