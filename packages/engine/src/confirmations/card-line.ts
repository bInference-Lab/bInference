import type { CardValueView } from "@binference/protocol";

/**
 * Every message key a card or its receipt uses (spec 4, section 3), the formats of its values
 * among them. Each key has an English and a Chinese message in `@binference/i18n`.
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
  "card.rescue.action",
  "card.unfreeze.agent",
  "card.unfreeze.all",
  "card.place.curve",
  "card.route",
  "card.fees",
  "card.check",
  "card.warn.outsideContent",
  "card.warn.unusualName",
  "card.warn.newAddress",
  "card.warn.unverified",
  "card.warn.highTax",
  "card.warn.requoted",
  "card.warn.placeChanged",
  "card.warn.noDeadline",
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
  "receipt.result",
] as const;

/** A message key of a card or a receipt. */
export type CardKey = (typeof cardKeys)[number];

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
