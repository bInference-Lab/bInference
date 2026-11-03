import type { Amount, ChainRef, ChainRegistry } from "@binference/chain";
import { amountValue, type CardDisplay, cardLineText } from "@binference/i18n";
import type { CardValueView, PortfolioView } from "@binference/protocol";
import type { CommandContext } from "./command-context.js";

type Values = Readonly<Record<string, CardValueView>>;
type Stake = NonNullable<PortfolioView["staking"]>[number];
type Transit = NonNullable<PortfolioView["inTransit"]>[number];

function line(display: CardDisplay, key: string, values: Values): string {
  return cardLineText({ key, values }, display);
}

// A chain as a reply names it: the registry's name, or its reference when the registry lacks it.
function chainValue(chains: ChainRegistry, chain: ChainRef): CardValueView {
  const registered = chains.get(chain);
  return { type: "text", text: registered.ok ? registered.value.definition.name : chain };
}

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
function stakedLine(display: CardDisplay, view: PortfolioView, stake: Stake): readonly string[] {
  const { staked } = stake;
  if (staked === undefined || staked.base === 0n) {
    return [];
  }
  const validator: CardValueView =
    stake.validator === undefined
      ? { type: "text", text: stake.venue }
      : { type: "account", account: stake.validator };
  const usd = usdOf(view, stake, staked);
  const amount = amountValue(stake.stakedValue ?? staked, display.assets);
  return [
    line(display, "positions.staked", {
      amount,
      validator,
      hasValue: { type: "choice", choice: usd === undefined ? "no" : "yes" },
      ...(usd === undefined ? {} : { value: usd }),
    }),
  ];
}

// What one stake holds: its units, each part not ready yet, and what a claim takes now.
function stakeLines(display: CardDisplay, view: PortfolioView, stake: Stake): readonly string[] {
  const { assets } = display;
  const waiting = stake.unbonding.map((part) =>
    line(display, "positions.unbonding", {
      amount: amountValue(part.amount, assets),
      readyAt: { type: "dateTime", atMs: part.readyAt },
    }),
  );
  const claimable =
    stake.claimable.base === 0n
      ? []
      : [line(display, "positions.claimable", { amount: amountValue(stake.claimable, assets) })];
  return [...stakedLine(display, view, stake), ...waiting, ...claimable];
}

function transitLine(context: CommandContext, display: CardDisplay, transit: Transit): string {
  return line(display, "positions.bridge", {
    amount: amountValue(transit.amount, display.assets),
    recipient: { type: "account", account: transit.recipient },
    chain: chainValue(context.chains, transit.toChain),
    since: { type: "dateTime", atMs: transit.sentAt },
    late: { type: "choice", choice: transit.late ? "yes" : "no" },
  });
}

// A heading and its lines as one block, or none without a line.
function blockOf(heading: string, lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [] : [[heading, ...lines].join("\n")];
}

/**
 * One mode's staking and bridges in transit under `/positions` (spec 4, section 5), from
 * `portfolio/get`: each stake's units as the coin they are worth and their dollars, its unbonding
 * parts and what a claim takes now, then each bridge in transit with its recipient, destination
 * chain and since when. Bridges are live only, so a paper mode shows none. Each is one block,
 * none when it holds nothing.
 */
export function stakingBlocks(
  context: CommandContext,
  view: PortfolioView,
  mode: "paper" | "live",
): readonly string[] {
  const isPaper = mode === "paper";
  const display = { formatter: context.formatter, assets: view.assets };
  const stakes = (view.staking ?? []).filter((stake) => stake.paper === isPaper);
  const transits = isPaper ? [] : (view.inTransit ?? []);
  return [
    ...blockOf(
      context.words("cmd.positions.staking"),
      stakes.flatMap((stake) => stakeLines(display, view, stake)),
    ),
    ...blockOf(
      context.words("cmd.positions.inTransit"),
      transits.map((transit) => transitLine(context, display, transit)),
    ),
  ];
}
