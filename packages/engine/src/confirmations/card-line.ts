import type { AccountRef, Amount, AssetRef, ChainRef } from "@binference/chain";
import type { Bps, Ratio } from "@binference/core";
import type { RouteLeg } from "@binference/protocol";

/**
 * Every message key a card or its receipt uses (spec 4, section 3). Each key has an English and a
 * Chinese message in `@binference/i18n`.
 */
export const cardKeys = [
  "card.header",
  "card.swap.action",
  "card.buy.action",
  "card.sell.action",
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
  "card.warn.paper",
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
  "card.reason",
  "card.expiry",
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
 * by the surface. `choice` is the value of an ICU `select`, and `count` of an ICU `plural`.
 */
export type CardValue =
  | { readonly type: "amount"; readonly amount: Amount }
  | { readonly type: "asset"; readonly asset: AssetRef }
  | { readonly type: "account"; readonly account: AccountRef }
  | { readonly type: "chain"; readonly chain: ChainRef }
  | { readonly type: "usd"; readonly usdMicros: bigint }
  | { readonly type: "percent"; readonly bps: Bps }
  | { readonly type: "ratio"; readonly ratio: Ratio }
  | { readonly type: "time"; readonly atMs: number }
  | { readonly type: "count"; readonly count: number }
  | { readonly type: "choice"; readonly choice: string }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "route"; readonly venue: string; readonly legs: readonly RouteLeg[] }
  | { readonly type: "line"; readonly line: CardLine };

/** One line of a card as data: a message key and the values of its arguments. */
export interface CardLine {
  readonly key: CardKey;
  readonly values: Readonly<Record<string, CardValue>>;
}
