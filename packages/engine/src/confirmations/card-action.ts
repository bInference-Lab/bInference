import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import { type Bps, bpsPerWhole } from "@binference/core";
import { type BridgeAction, bridgeActionLine } from "./bridge-card-lines.js";
import type { CardLine, CardValue } from "./card-line.js";
import type { LaunchDetails } from "./launch-card-lines.js";
import { type CardOrderRequest, orderSummaryLine } from "./order-card-lines.js";
import { type CardPayee, type CardSentName, sendActionLine } from "./send-card-lines.js";
import { type StakeDetails, validatorValue } from "./stake-card-lines.js";

/** Where a buy or a sell trades: a launchpad's bonding curve, or a venue's pool. */
export type TradePlace = { readonly curve: string } | { readonly pool: string };

/**
 * A staking move; an unstake says in how many whole days the amount can be claimed. The
 * validator's name, as its venue lists it, shows before its address; its details show under the
 * action line (`stakeDetailLines`).
 */
export type StakeMove = {
  readonly amount: Amount;
  readonly validator: AccountRef;
  readonly validatorName?: string;
  readonly details?: StakeDetails;
} & (
  | { readonly action: "stake" | "claim" }
  | { readonly action: "unstake"; readonly readyInDays: number }
);

/**
 * The facts of each kind's action line (spec 4, section 3.3), resolved from the stored intent:
 * amounts in base units, the recipient as an address, venue and launchpad names as their plugins
 * write them.
 */
export interface CardActionFacts {
  readonly swap: { readonly amountIn: Amount; readonly minOut: Amount };
  readonly buy: { readonly token: AssetRef; readonly spend: Amount; readonly place: TradePlace };
  /** A sale by share names it: the share of the holding, whose amount the quote fixed. */
  readonly sell: {
    readonly amount: Amount;
    readonly minOut: Amount;
    readonly place: TradePlace;
    readonly share?: Bps;
  };
  /**
   * A send by name names the name its card shows beside the address (decision 0308); any other
   * names who it pays (spec 4, section 3.9).
   */
  readonly send: {
    readonly amount: Amount;
    readonly recipient: AccountRef;
    readonly name?: CardSentName;
    readonly payee?: CardPayee;
  };
  /** `spenderName` is the spender as the chain registry names it, its venue and contract. */
  readonly revokeApproval: {
    readonly token: AssetRef;
    readonly spender: AccountRef;
    readonly spenderName?: string;
  };
  readonly stake: StakeMove;
  /** Who a bridge pays as its card names them, and what shows under its action (decision 0297). */
  readonly bridge: BridgeAction;
  /** `size` and `price` are decimal text in the market's units, as the exchange writes them. */
  readonly cexOrder: {
    readonly side: "buy" | "sell";
    readonly size: string;
    readonly market: string;
    /** The limit price, or the price the plugin quoted for a market order. */
    readonly price: string;
  };
  readonly registerIdentity: { readonly agent: string };
  /**
   * `firstBuy` is zero when the request asks for no first buy. `details` holds every other
   * setting, each on a line of its own under the action line (decision 0235).
   */
  readonly launchToken: {
    readonly symbol: string;
    readonly name: string;
    readonly venue: string;
    readonly pair: AssetRef;
    readonly firstBuy: Amount;
    readonly details?: LaunchDetails;
  };
  readonly rescue: {
    readonly address: AccountRef;
    readonly tokenCount: number;
    readonly walletCount: number;
    readonly valueUsdMicros: bigint;
  };
  /**
   * One agent's unfreeze names it; a whole-install unfreeze counts the agents frozen now
   * (decision 0128).
   */
  readonly unfreeze:
    | { readonly scope: "agent"; readonly agent: string }
    | { readonly scope: "install"; readonly agentCount: number };
  /**
   * An auto order's terms with every default filled (decision 0189): what it trades and when, how
   * many fills it allows, none for no limit, and until when.
   */
  readonly autoOrder: {
    readonly request: CardOrderRequest;
    readonly maxFills?: number;
    readonly expiresAtMs: number;
    /** A DCA order's first two runs after its card was drawn, in epoch milliseconds. */
    readonly firstRunsAtMs?: readonly [number, number];
    /** A copy order's leader's label in the agent's address book (decision 0261). */
    readonly leaderLabel?: string;
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

// Spec 4, section 3.6: a sale by share says the share and what it came to; all of it says all.
function sellLine(action: CardAction<"sell">): CardLine {
  const values = {
    amount: amount(action.amount),
    minOut: amount(action.minOut),
    place: placeOf(action.place),
  };
  const { share } = action;
  if (share === undefined) {
    return { key: "card.sell.action", values };
  }
  const token = asset(action.amount.asset);
  return share === bpsPerWhole
    ? { key: "card.sell.all", values: { ...values, token } }
    : {
        key: "card.sell.share",
        values: { ...values, token, share: { type: "percent", bps: share } },
      };
}

// A revoke's spender by its registry name before its address (decision 0309), or its address.
function spenderOf(action: CardAction<"revokeApproval">): CardValue {
  const { spenderName, spender } = action;
  return spenderName === undefined
    ? account(spender)
    : {
        type: "line",
        line: {
          key: "card.value.spender",
          values: { contract: text(spenderName), address: account(spender) },
        },
      };
}

function stakeLine(move: StakeMove): CardLine {
  const values = { amount: amount(move.amount), validator: validatorValue(move) };
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
  sell: sellLine,
  send: sendActionLine,
  revokeApproval: (action) => ({
    key: "card.revoke.action",
    values: { spender: spenderOf(action), token: asset(action.token) },
  }),
  stake: stakeLine,
  bridge: bridgeActionLine,
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
      tokenName: text(action.name),
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
  unfreeze: (action) =>
    action.scope === "agent"
      ? { key: "card.unfreeze.agent", values: { agent: text(action.agent) } }
      : { key: "card.unfreeze.all", values: { count: count(action.agentCount) } },
  autoOrder: (action) => ({
    key: "card.order.action",
    values: {
      ...orderTermsOf(action),
      maxFills: count(action.maxFills ?? 0),
      expiry: { type: "dateTime", atMs: action.expiresAtMs },
    },
  }),
};

/**
 * An auto order's kind and its summary (spec 4, section 3.8), as its card's action line and its
 * receipt name them.
 */
export function orderTermsOf(action: CardAction<"autoOrder">): {
  readonly orderKind: CardValue;
  readonly summary: CardValue;
} {
  const kind: CardValue = { type: "choice", choice: action.request.kind };
  const summary = orderSummaryLine(action.request, {
    ...(action.firstRunsAtMs === undefined ? {} : { firstRuns: action.firstRunsAtMs }),
    ...(action.leaderLabel === undefined ? {} : { leaderLabel: action.leaderLabel }),
  });
  return {
    orderKind: { type: "line", line: { key: "order.kind", values: { kind } } },
    summary: { type: "line", line: summary },
  };
}

/** The action line of a card (spec 4, section 3.3): its kind's message key and values. */
export function actionLine<K extends CardActionKind>(action: CardAction<K>): CardLine {
  const draw: (action: CardAction<K>) => CardLine = actionLines[action.kind];
  return draw(action);
}

const verbs: { readonly [K in Exclude<CardActionKind, "stake">]: string } = {
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
  unfreeze: "unfreeze",
  autoOrder: "autoOrder",
};

/** The verb the card's header confirms: the kind, or a stake move such as `unstake`. */
export function actionVerb(action: CardAction): string {
  return action.kind === "stake" ? action.action : verbs[action.kind];
}
