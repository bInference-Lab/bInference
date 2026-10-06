import type { AccountRef, Amount, AssetRef, ChainRef } from "@binference/chain";
import type { Ratio } from "@binference/core";
import type { CardLine, CardValue } from "./card-line.js";

/** Where a buy or a sell trades: a launchpad's bonding curve, or a venue's pool. */
export type TradePlace = { readonly curve: string } | { readonly pool: string };

/** A staking move; an unstake says when the amount can be claimed. */
export type StakeMove =
  | {
      readonly action: "stake" | "claim";
      readonly amount: Amount;
      readonly validator: AccountRef;
    }
  | {
      readonly action: "unstake";
      readonly amount: Amount;
      readonly validator: AccountRef;
      readonly readyInDays: number;
    };

/**
 * The facts of each kind's action line (spec 4, section 3.3), resolved from the stored intent:
 * amounts in base units, the recipient as an address, venue and launchpad names as their plugins
 * write them.
 */
export interface CardActionFacts {
  readonly swap: { readonly amountIn: Amount; readonly minOut: Amount };
  readonly buy: { readonly token: AssetRef; readonly spend: Amount; readonly place: TradePlace };
  readonly sell: { readonly amount: Amount; readonly minOut: Amount; readonly place: TradePlace };
  readonly send: { readonly amount: Amount; readonly recipient: AccountRef };
  readonly revokeApproval: { readonly token: AssetRef; readonly spender: AccountRef };
  readonly lend: {
    readonly action: "supply" | "withdraw" | "borrow" | "repay";
    readonly amount: Amount;
    readonly venue: string;
    /** The health factor after the move, as the venue reports it. */
    readonly healthFactor: Ratio;
  };
  readonly stake: StakeMove;
  readonly bridge: {
    readonly amount: Amount;
    readonly chain: ChainRef;
    readonly recipient: AccountRef;
    readonly minutes: number;
  };
  /** `size` and `price` are decimal text in the market's units, as the exchange writes them. */
  readonly cexOrder: {
    readonly side: "buy" | "sell";
    readonly size: string;
    readonly market: string;
    /** The limit price, or the price the plugin quoted for a market order. */
    readonly price: string;
  };
  readonly registerIdentity: { readonly agent: string };
  /** `firstBuy` is zero when the request asks for no first buy. */
  readonly launchToken: {
    readonly symbol: string;
    readonly name: string;
    readonly venue: string;
    readonly pair: AssetRef;
    readonly firstBuy: Amount;
  };
  readonly rescue: {
    readonly address: AccountRef;
    readonly tokenCount: number;
    readonly walletCount: number;
    readonly valueUsdMicros: bigint;
  };
}

/** The kind of a card's action. */
export type CardActionKind = keyof CardActionFacts;

/** What a card asks the owner to confirm: its kind and the facts of its action line. */
export type CardAction<K extends CardActionKind = CardActionKind> = {
  readonly [P in K]: { readonly kind: P } & CardActionFacts[P];
}[K];

const amount = (value: Amount): CardValue => ({ type: "amount", amount: value });
const asset = (value: AssetRef): CardValue => ({ type: "asset", asset: value });
const account = (value: AccountRef): CardValue => ({ type: "account", account: value });
const text = (value: string): CardValue => ({ type: "text", text: value });
const count = (value: number): CardValue => ({ type: "count", count: value });

function placeOf(place: TradePlace): CardValue {
  return "curve" in place
    ? { type: "line", line: { key: "card.place.curve", values: { launchpad: text(place.curve) } } }
    : text(place.pool);
}

function stakeLine(move: StakeMove): CardLine {
  const values = { amount: amount(move.amount), validator: account(move.validator) };
  return move.action === "unstake"
    ? { key: "card.stake.unstake", values: { ...values, days: count(move.readyInDays) } }
    : { key: `card.stake.${move.action}`, values };
}

type ActionLines = { readonly [K in CardActionKind]: (action: CardAction<K>) => CardLine };

const actionLines: ActionLines = {
  swap: (action) => ({
    key: "card.swap.action",
    values: { in: amount(action.amountIn), minOut: amount(action.minOut) },
  }),
  buy: (action) => ({
    key: "card.buy.action",
    values: {
      token: asset(action.token),
      spend: amount(action.spend),
      place: placeOf(action.place),
    },
  }),
  sell: (action) => ({
    key: "card.sell.action",
    values: {
      amount: amount(action.amount),
      minOut: amount(action.minOut),
      place: placeOf(action.place),
    },
  }),
  send: (action) => ({
    key: "card.send.action",
    values: { amount: amount(action.amount), recipient: account(action.recipient) },
  }),
  revokeApproval: (action) => ({
    key: "card.revoke.action",
    values: { spender: account(action.spender), token: asset(action.token) },
  }),
  lend: (action) => ({
    key: `card.lend.${action.action}`,
    values: {
      amount: amount(action.amount),
      venue: text(action.venue),
      hf: { type: "ratio", ratio: action.healthFactor },
    },
  }),
  stake: stakeLine,
  bridge: (action) => ({
    key: "card.bridge.action",
    values: {
      amount: amount(action.amount),
      chain: { type: "chain", chain: action.chain },
      recipient: account(action.recipient),
      minutes: count(action.minutes),
    },
  }),
  cexOrder: (action) => ({
    key: "card.cex.action",
    values: {
      side: { type: "choice", choice: action.side },
      size: text(action.size),
      market: text(action.market),
      price: text(action.price),
    },
  }),
  registerIdentity: (action) => ({
    key: "card.identity.action",
    values: { agent: text(action.agent) },
  }),
  launchToken: (action) => ({
    key: "card.launch.action",
    values: {
      symbol: text(action.symbol),
      name: text(action.name),
      venue: text(action.venue),
      pair: asset(action.pair),
      firstBuy: amount(action.firstBuy),
    },
  }),
  rescue: (action) => ({
    key: "card.rescue.action",
    values: {
      address: account(action.address),
      count: count(action.tokenCount),
      wallets: count(action.walletCount),
      usd: { type: "usd", usdMicros: action.valueUsdMicros },
    },
  }),
};

/** The action line of a card (spec 4, section 3.3): its kind's message key and values. */
export function actionLine<K extends CardActionKind>(action: CardAction<K>): CardLine {
  const draw: (action: CardAction<K>) => CardLine = actionLines[action.kind];
  return draw(action);
}

const verbs: { readonly [K in Exclude<CardActionKind, "lend" | "stake">]: string } = {
  swap: "swap",
  buy: "buy",
  sell: "sell",
  send: "send",
  revokeApproval: "revoke",
  bridge: "bridge",
  cexOrder: "order",
  registerIdentity: "register",
  launchToken: "launch",
  rescue: "rescue",
};

/** The verb the card's header confirms: the kind, or a lend or stake move such as `supply`. */
export function actionVerb(action: CardAction): string {
  return action.kind === "lend" || action.kind === "stake" ? action.action : verbs[action.kind];
}
