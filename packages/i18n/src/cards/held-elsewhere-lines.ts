import type { Amount } from "@binference/chain";
import type { CardLineView, CardValueView, PortfolioView } from "@binference/protocol";
import { amountValue } from "./asset-values.js";

type Stake = NonNullable<PortfolioView["staking"]>[number];
type Transit = NonNullable<PortfolioView["inTransit"]>[number];

// The dollars the stake's receipt units are worth as their balance, when it has a price.
function usdOf(view: PortfolioView, stake: Stake, staked: Amount): CardValueView | undefined {
  const balance = view.balances.find(
    ({ wallet, paper, amount }) =>
      wallet === stake.wallet && paper === stake.paper && amount.asset === staked.asset,
  );
  return balance?.usdMicros === undefined
    ? undefined
    : { type: "usd", usdMicros: balance.usdMicros };
}

// The stake's units as the coin they are worth, and their dollars or that the value is unknown.
function stakedLine(view: PortfolioView, stake: Stake): readonly CardLineView[] {
  const { staked } = stake;
  if (staked === undefined || staked.base === 0n) {
    return [];
  }
  const validator: CardValueView =
    stake.validator === undefined
      ? { type: "text", text: stake.venue }
      : { type: "account", account: stake.validator };
  const usd = usdOf(view, stake, staked);
  return [
    {
      key: "positions.staked",
      values: {
        amount: amountValue(stake.stakedValue ?? staked, view.assets),
        validator,
        hasValue: { type: "choice", choice: usd === undefined ? "no" : "yes" },
        ...(usd === undefined ? {} : { value: usd }),
      },
    },
  ];
}

/**
 * What one stake of a portfolio holds, as `/positions` and the console's portfolio show it (spec
 * 4, section 5): its receipt units as the coin they are worth with their dollars, each unbonding
 * part with when a claim can take it, and what a claim takes now. No line for units of nothing
 * or nothing to claim.
 */
export function stakeLines(view: PortfolioView, stake: Stake): readonly CardLineView[] {
  const { assets } = view;
  const waiting = stake.unbonding.map((part): CardLineView => ({
    key: "positions.unbonding",
    values: {
      amount: amountValue(part.amount, assets),
      readyAt: { type: "dateTime", atMs: part.readyAt },
    },
  }));
  const claimable: readonly CardLineView[] =
    stake.claimable.base === 0n
      ? []
      : [{ key: "positions.claimable", values: { amount: amountValue(stake.claimable, assets) } }];
  return [...stakedLine(view, stake), ...waiting, ...claimable];
}

/**
 * One bridge in transit of a portfolio, as `/positions` and the console's portfolio show it (spec
 * 4, section 5): what left, its recipient, the destination chain by the name given, since when,
 * and whether it is late.
 */
export function transitLine(view: PortfolioView, transit: Transit, chain: string): CardLineView {
  return {
    key: "positions.bridge",
    values: {
      amount: amountValue(transit.amount, view.assets),
      recipient: { type: "account", account: transit.recipient },
      chain: { type: "text", text: chain },
      since: { type: "dateTime", atMs: transit.sentAt },
      late: { type: "choice", choice: transit.late ? "yes" : "no" },
    },
  };
}
