import { addressPartOf, createFormatter, type Formatter, shortAddress } from "@binference/i18n";
import type { AssetInfos, BalanceView, LiveFactsView, OrderView } from "@binference/protocol";

type Amount = BalanceView["amount"];
type AssetRef = Amount["asset"];

/**
 * The settings in force as a turn starts that the agent's work depends on, so a turn never acts on
 * an earlier turn's settings: the model it talks with, and those that make images and videos and
 * speak.
 */
export interface SettingsFacts {
  readonly mainModel?: string;
  readonly imageMakingModel?: string;
  readonly videoMakingModel?: string;
  /** A speech model, or `local` for the voice of the engine's machine. */
  readonly speechModel?: string;
}

/** What the volatile tail says: the live facts when they could be read, and the budget left. */
export interface TailFacts {
  readonly facts?: LiveFactsView;
  readonly settings?: SettingsFacts;
  /** The line of the chat's goal, read for this call (decision 0407). */
  readonly goal?: string;
  /** What is left of today's model budget, in micro-dollars, as the engine last answered. */
  readonly budgetLeftMicros?: bigint;
}

const heading = "Live facts from binference, read for this call. They are not the owner's words.";

// A token by its symbol; one the registry does not list by the words "unlisted token" and its
// short address, since its symbol is its deployer's words (runtime spec, section 5.4).
function tokenText(asset: AssetRef, assets: AssetInfos): string {
  const info = assets[asset];
  const address = shortAddress(addressPartOf(asset));
  if (info === undefined) {
    return address;
  }
  return info.verified ? info.symbol : `unlisted token (${address})`;
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

// The breaker's hold is bInference's, so no unfreeze of the owner's lifts it (decision 0441).
function frozenText(facts: LiveFactsView): string {
  if (facts.breaker === true) {
    return "yes, by bInference's breaker, which no unfreeze lifts; nothing trades until bInference lifts it";
  }
  return facts.frozen ? "yes" : "no";
}

function factLines(facts: LiveFactsView): readonly string[] {
  const formatter = createFormatter({ locale: "en", timeZone: facts.timeZone });
  const orders = facts.orders.map((order) => orderText(order, facts.assets));
  return [
    `- Time: ${formatter.dateTime(facts.at)} (${facts.timeZone}).`,
    `- Mode: ${facts.mode}. Frozen: ${frozenText(facts)}. Approval mode: ${facts.approvalMode}. Send level: ${String(facts.sendLevel)}.`,
    balancesLine(facts, formatter),
    `- Open orders: ${orders.length === 0 ? "none" : orders.join("; ")}.`,
    `- Spent in the last 24 hours: ${formatter.usd(facts.spentTodayUsdMicros)} of the ${formatter.usd(facts.rollingDayUsdMicros)} cap. Per-trade cap: ${formatter.usd(facts.perTradeUsdMicros)}.`,
  ];
}

// The models in force now; an earlier turn may have run on others, so its failures may not hold.
function settingsLine(settings: SettingsFacts): string {
  const main = settings.mainModel ?? "none set";
  const images = settings.imageMakingModel ?? "none set";
  const videos = settings.videoMakingModel ?? "none set";
  const speech = settings.speechModel ?? "none set";
  return `- Models in force now: talks with ${main}; makes images with ${images}; makes videos with ${videos}; speaks with ${speech}. Settings may have changed since earlier turns, so an earlier failure does not hold now.`;
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
  const settings = tail.settings === undefined ? [] : [settingsLine(tail.settings)];
  const goal = tail.goal === undefined ? [] : [tail.goal];
  return [heading, ...facts, ...settings, ...goal, ...budget].join("\n");
}
