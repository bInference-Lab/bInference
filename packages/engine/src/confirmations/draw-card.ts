import type { Amount, AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import type { RouteLeg } from "@binference/protocol";
import type { AutoModeRefusal } from "../intents/auto-mode.js";
import type { CardTerms } from "../intents/intent-status.js";
import { actionLine, actionVerb, type CardAction } from "./card-action.js";
import type { CardKey, CardLine, CardValue } from "./card-line.js";

/** The route line: the venue that quoted, its legs with their shares, the impact and the limit. */
export interface CardRoute {
  readonly venue: string;
  readonly legs: readonly RouteLeg[];
  readonly priceImpactBps: Bps;
  readonly maxSlippageBps: Bps;
}

/** The fees line: the network fee in micro-dollars, and whether a private relay sends it. */
export interface CardFees {
  readonly networkFeeUsdMicros: bigint;
  readonly isPrivateSend: boolean;
}

/** The check line: what the simulation says the wallet receives, and the token's verdict. */
export interface CardCheck {
  readonly received: Amount;
  /** The token the risk check is about. */
  readonly token: AssetRef;
  /** The token is in the chain registry; otherwise it passed every risk source. */
  readonly isTokenVerified: boolean;
}

/**
 * Why auto mode leaves an intent to the owner's tap: a code of the auto test other than `manual`
 * (spec 6, section 5). An MCP proposal names its client.
 */
export type AutoAsk =
  | { readonly code: Exclude<AutoModeRefusal, "manual" | "mcp"> }
  | { readonly code: "mcp"; readonly client: string };

/** The warnings whose facts come from outside the intent's own flags. */
export interface CardWarnings {
  /** A token's name or symbol mixes scripts or holds look-alike characters. */
  readonly hasUnusualName: boolean;
  /** The wallet has never sent to the recipient. */
  readonly isNewAddress: boolean;
  /** The token's tax on every trade; zero or absent shows no warning. */
  readonly taxBps?: Bps;
  readonly autoAsk?: AutoAsk;
  /** The agent's first live card, which says so (`isFirstLiveCard`); absent shows no note. */
  readonly isFirstLive?: boolean;
}

/**
 * What a card is drawn from: the stored intent and the facts resolved for it. A line without its
 * facts is left out.
 */
export interface CardFacts {
  readonly agentName: string;
  readonly isPaper: boolean;
  readonly hasOutsideContent: boolean;
  /** The card version on show. A version after the first comes from a worse re-quote. */
  readonly card: CardTerms;
  readonly action: CardAction;
  readonly route?: CardRoute;
  readonly fees?: CardFees;
  readonly check?: CardCheck;
  readonly warnings: CardWarnings;
  /**
   * The agent's reason from the request, the only model words on a card. Each surface escapes it
   * and cuts it to 200 characters (spec 4, section 1).
   */
  readonly reason?: string;
}

/**
 * One card version as data (spec 4, section 3.1): its lines in order, each a message key with
 * its values. Each surface renders the lines in the owner's language.
 */
export interface Card {
  readonly version: number;
  readonly expiresAtMs: number;
  readonly lines: readonly CardLine[];
}

const choice = (value: string): CardValue => ({ type: "choice", choice: value });
const percent = (bps: Bps): CardValue => ({ type: "percent", bps });
const bare = (key: CardKey): CardLine => ({ key, values: {} });

function headerLine(facts: CardFacts): CardLine {
  return {
    key: "card.header",
    values: {
      action: choice(actionVerb(facts.action)),
      agent: { type: "text", text: facts.agentName },
      mode: choice(facts.isPaper ? "paper" : "live"),
    },
  };
}

function routeLine(route: CardRoute): CardLine {
  return {
    key: "card.route",
    values: {
      route: { type: "route", venue: route.venue, legs: route.legs },
      impact: percent(route.priceImpactBps),
      slippage: percent(route.maxSlippageBps),
    },
  };
}

function feesLine(fees: CardFees): CardLine {
  return {
    key: "card.fees",
    values: {
      fee: { type: "usd", usdMicros: fees.networkFeeUsdMicros },
      privateSend: choice(fees.isPrivateSend ? "yes" : "no"),
    },
  };
}

function checkLine(check: CardCheck): CardLine {
  return {
    key: "card.check",
    values: {
      received: { type: "amount", amount: check.received },
      token: { type: "asset", asset: check.token },
      verified: choice(check.isTokenVerified ? "yes" : "no"),
    },
  };
}

function autoAskLine(ask: AutoAsk): CardLine {
  const why: CardLine =
    ask.code === "mcp"
      ? { key: "autoAsks.mcp", values: { client: { type: "text", text: ask.client } } }
      : bare(`autoAsks.${ask.code}`);
  return { key: "card.warn.autoAsks", values: { why: { type: "line", line: why } } };
}

function optional<T>(value: T | undefined, draw: (value: T) => CardLine): readonly CardLine[] {
  return value === undefined ? [] : [draw(value)];
}

function shown(flagged: readonly (readonly [boolean, CardKey])[]): readonly CardLine[] {
  return flagged.filter(([isShown]) => isShown).map(([, key]) => bare(key));
}

function taxLines(taxBps: Bps | undefined): readonly CardLine[] {
  return taxBps === undefined || taxBps === 0
    ? []
    : [{ key: "card.warn.highTax", values: { tax: percent(taxBps) } }];
}

// The order of spec 4, section 3.1: outside content, unusual characters, new address, then the
// token's risk warnings; then the rest in the order of section 3.4.
function warningLines(facts: CardFacts): readonly CardLine[] {
  const { warnings } = facts;
  return [
    ...shown([
      [facts.hasOutsideContent, "card.warn.outsideContent"],
      [warnings.hasUnusualName, "card.warn.unusualName"],
      [warnings.isNewAddress, "card.warn.newAddress"],
      [facts.check?.isTokenVerified === false, "card.warn.unverified"],
    ]),
    ...taxLines(warnings.taxBps),
    ...shown([
      [facts.card.version > 1, "card.warn.requoted"],
      [facts.isPaper, "card.warn.paper"],
      [warnings.isFirstLive === true && !facts.isPaper, "card.warn.firstLive"],
    ]),
    ...optional(warnings.autoAsk, autoAskLine),
  ];
}

/**
 * Draws one card version from its facts (spec 4, section 3): the header, the action, the route,
 * the fees, the check, the warnings, what the agent says and the expiry, in that order. Lines
 * without facts are left out.
 */
export function drawCard(facts: CardFacts): Card {
  const lines: readonly CardLine[] = [
    headerLine(facts),
    actionLine(facts.action),
    ...optional(facts.route, routeLine),
    ...optional(facts.fees, feesLine),
    ...optional(facts.check, checkLine),
    ...warningLines(facts),
    ...optional(facts.reason, (reason) => ({
      key: "card.reason",
      values: { reason: { type: "text", text: reason } },
    })),
    { key: "card.expiry", values: { time: { type: "time", atMs: facts.card.expiresAtMs } } },
  ];
  return { version: facts.card.version, expiresAtMs: facts.card.expiresAtMs, lines };
}
