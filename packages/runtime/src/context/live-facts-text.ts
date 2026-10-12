import { addressPartOf, createFormatter, type Formatter, shortAddress } from "@binference/i18n";
import type { AssetInfos, BalanceView, LiveFactsView, OrderView } from "@binference/protocol";

type Amount = BalanceView["amount"];
type AssetRef = Amount["asset"];

/** What the volatile tail says: the live facts when they could be read, and the budget left. */
export interface TailFacts {
  readonly facts?: LiveFactsView;
  /** What is left of today's model budget, in micro-dollars, as the engine last answered. */
  readonly budgetLeftMicros?: bigint;
}

const heading = "Live facts from binference, read for this call. They are not the owner's words.";

// A token by its symbol, followed by its short address when the registry does not list it.
function tokenText(asset: AssetRef, assets: AssetInfos): string {
  const info = assets[asset];
  const address = shortAddress(addressPartOf(asset));
  if (info === undefined) {
    return address;
  }
  return info.verified ? info.symbol : `${info.symbol} (${address})`;
}

function amountText(amount: Amount, assets: AssetInfos, formatter: Formatter): string {
  const info = assets[amount.asset];
  const units =
    info === undefined ? amount.base.toString() : formatter.tokenAmount(amount.base, info.decimals);
  return `${units} ${tokenText(amount.asset, assets)}`;
}

function balancesLine(facts: LiveFactsView, formatter: Formatter): string {
  const { balances, totalUsdMicros, assets } = facts;
  if (balances === undefined) {
    return "- Balances: could not be read now.";
  }
  const each = balances.map((balance) => {
    const value = balance.usdMicros === undefined ? "no price" : formatter.usd(balance.usdMicros);
    return `${amountText(balance.amount, assets, formatter)} (${value})`;
  });
  const total = totalUsdMicros === undefined ? "" : ` Total ${formatter.usd(totalUsdMicros)}.`;
  return `- Balances: ${each.length === 0 ? "none" : each.join("; ")}.${total}`;
}

function orderText(order: OrderView, assets: AssetInfos): string {
  const { request } = order;
  return `${order.kind} ${request.side} ${tokenText(request.token, assets)}, ${order.state} (${order.order})`;
}

function factLines(facts: LiveFactsView): readonly string[] {
  const formatter = createFormatter({ locale: "en", timeZone: facts.timeZone });
  const orders = facts.orders.map((order) => orderText(order, facts.assets));
  return [
    `- Time: ${formatter.dateTime(facts.at)} (${facts.timeZone}).`,
    `- Mode: ${facts.mode}. Frozen: ${facts.frozen ? "yes" : "no"}. Approval mode: ${facts.approvalMode}. Send level: ${String(facts.sendLevel)}.`,
    balancesLine(facts, formatter),
    `- Open orders: ${orders.length === 0 ? "none" : orders.join("; ")}.`,
    `- Spent in the last 24 hours: ${formatter.usd(facts.spentTodayUsdMicros)} of the ${formatter.usd(facts.rollingDayUsdMicros)} cap. Per-trade cap: ${formatter.usd(facts.perTradeUsdMicros)}.`,
  ];
}

/**
 * The volatile tail as the model reads it after the history (runtime spec, section 7.1): the time
 * in the owner's timezone, the mode, the freeze, the approval mode and send level, the balances
 * with their dollar values, the open orders, the spend against the caps, and the model budget
 * left. Facts that could not be read are said to be missing. A token the registry does not list
 * is named with its short address.
 */
export function liveFactsText(tail: TailFacts): string {
  const usd = createFormatter({ locale: "en", timeZone: "UTC" }).usd;
  const budget =
    tail.budgetLeftMicros === undefined
      ? []
      : [`- Model budget left today: ${usd(tail.budgetLeftMicros)}.`];
  const facts =
    tail.facts === undefined ? ["- The live facts could not be read now."] : factLines(tail.facts);
  return [heading, ...facts, ...budget].join("\n");
}
