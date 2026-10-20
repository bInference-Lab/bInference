import type { CardValueView } from "@binference/protocol";
import type { IntentReason } from "../intents/intent-reason.js";

/**
 * Every message key a card, its receipt or a P&L card uses (spec 4, section 3), the formats of
 * its values among them. Each key has an English and a Chinese message in `@binference/i18n`.
 */
export const cardKeys = [
  "card.header",
  // The console's header line: the same, without the mode, which the console marks with a label.
  "card.header.console",
  "card.swap.action",
  "card.buy.action",
  "card.sell.action",
  "card.sell.share",
  "card.sell.all",
  "card.send.action",
  "card.revoke.action",
  "card.lend.supply",
  "card.lend.withdraw",
  "card.lend.borrow",
  "card.lend.repay",
  "card.stake.stake",
  "card.stake.unstake",
  "card.stake.claim",
  "card.bridge.action",
  "card.cex.action",
  "card.identity.action",
  "card.launch.action",
  "card.launch.token",
  "card.launch.firstBuyMin",
  "card.launch.fee",
  "card.launch.description",
  "card.launch.link",
  "card.launch.picture",
  "card.launch.writtenPicture",
  "card.launch.photo",
  "card.launch.upload",
  "card.launch.pinned",
  "card.rescue.action",
  "card.unfreeze.agent",
  "card.unfreeze.all",
  "card.order.action",
  "card.order.sell",
  "card.order.spend",
  "card.order.condition",
  "card.order.summary.limitBuy",
  "card.order.summary.limitSell",
  "card.order.summary.takeProfit",
  "card.order.summary.stopLoss",
  "card.order.summary.trailing",
  "card.order.summary.dca",
  "card.order.summary.copy",
  "card.order.leader",
  "card.order.schedule",
  "card.order.exitsLinked",
  "card.order.worstPrice",
  "order.kind",
  "card.place.curve",
  "card.launchWallet",
  "card.route",
  "card.fees",
  "card.check",
  "card.warn.outsideContent",
  "card.warn.unusualName",
  "card.warn.newAddress",
  "card.warn.unverified",
  "card.warn.highTax",
  "card.warn.poolFee",
  "card.warn.requoted",
  "card.warn.placeChanged",
  "card.warn.noDeadline",
  "card.warn.unboundFirstBuy",
  "card.warn.paper",
  "card.warn.paperEstimate",
  "card.warn.firstLive",
  "card.warn.autoAsks",
  "autoAsks.send",
  "autoAsks.kind",
  "autoAsks.overCap",
  "autoAsks.spender",
  "autoAsks.outside",
  "autoAsks.mcp",
  "autoAsks.deniedToken",
  "autoAsks.overFeeCap",
  "autoAsks.locked",
  "card.reason",
  "card.expiry",
  "card.value.unverifiedToken",
  "card.value.route",
  "card.value.routeLeg",
  "card.value.legSeparator",
  "receipt.confirmed",
  "receipt.denied",
  "receipt.expired",
  "receipt.paper",
  "receipt.auto",
  "receipt.filled",
  "receipt.launched",
  "receipt.launchedAlone",
  "receipt.failed",
  "receipt.result",
  // The P&L card's lines (spec 4, section 3.7).
  "pnl.header",
  "pnl.headerClosed",
  "pnl.holding",
  "pnl.holdingNoValue",
  "pnl.cost",
  "pnl.open",
  "pnl.closed",
  "pnl.trades",
  "pnl.fees",
  "pnl.since",
  "pnl.held",
  "pnl.noPrice",
  "pnl.noPercent",
  "pnl.days",
  "pnl.hours",
  "pnl.minutes",
] as const;

/**
 * A message key of a card or a receipt, of a launchpad setting's card line, `launch.option.` and
 * the setting's name (decision 0235), of a launchpad's card warning, `launch.warn.` and its
 * name (decision 0281), which the launch host checks exists in every language, or of an intent's
 * reason, `reason.` and its code, as a receipt names why an intent failed.
 */
export type CardKey =
  | (typeof cardKeys)[number]
  | `launch.option.${string}`
  | `launch.warn.${string}`
  | `reason.${IntentReason}`;

/**
 * One argument of a card line, typed so every surface formats it with the one formatter: an
 * amount to 6 significant digits with its symbol, USD with 2 decimals, a time in the owner's
 * timezone. `text` is set by someone else (the agent, a token's deployer, a venue) and is escaped
 * by the surface. `choice` is the value of an ICU `select`, and `count` of an ICU `plural`. The
 * protocol's {@link CardValueView} carries the same values; a nested line here is a card line.
 */
export type CardValue =
  | Exclude<CardValueView, { readonly type: "line" }>
  | { readonly type: "line"; readonly line: CardLine };

/** One line of a card as data: a message key and the values of its arguments. */
export interface CardLine {
  readonly key: CardKey;
  readonly values: Readonly<Record<string, CardValue>>;
}
