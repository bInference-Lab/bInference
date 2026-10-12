import { type AssetRef, assetRefParts, type ChainRegistry } from "@binference/chain";
import type { Bps, JsonValue } from "@binference/core";
import type {
  BuyRequest,
  QuoteView,
  SellRequest,
  SimulationView,
  SwapRequest,
} from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { limitsRecordAt } from "../agents/limits-in-effect.js";
import type { CardAction, TradePlace } from "../confirmations/card-action.js";
import type { CardCheck, CardFacts, CardRoute } from "../confirmations/draw-card.js";
import type { CardRecord } from "../intents/card-record.js";
import {
  quoteDocument,
  requestDocument,
  riskDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type RescueQuote, rescueQuoteDocument } from "../intents/rescue-quote.js";
import { isSamePlace } from "../intents/same-place.js";
import { type UnfreezeQuote, unfreezeQuoteDocument } from "../intents/unfreeze-quote.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { tradeSlippageBps } from "../money-path/swap-trade.js";
import { type AutoOrderQuote, autoOrderQuoteDocument } from "../orders/auto-order-quote.js";
import { isExitOrder } from "../orders/order-record.js";
import type { VenueHost } from "../venues/venue-host.js";

function isNativeAsset(chains: ChainRegistry, asset: AssetRef): boolean {
  const chain = chains.get(assetRefParts(asset).chain);
  return chain.ok && nativeAssetOf(chain.value) === asset;
}

/** What a card version's facts are read from: the stored intent, the version and its agent. */
export interface CardSource {
  readonly record: IntentRecord;
  readonly card: CardRecord;
  /** The card version before this one, which a worse re-quote or a new place replaced. */
  readonly previous?: CardRecord;
  readonly settings: AgentSettings;
  /** Whether the card is the agent's first live card (`isFirstLiveCard`). */
  readonly isFirstLive: boolean;
  readonly chains: ChainRegistry;
  /** Which venues declare that their trade calls on a chain carry no deadline. */
  readonly venues: Pick<VenueHost, "hasNoDeadline">;
}

/** A request the money path quotes: a swap, a buy or a sell. */
type TradeRequest = SwapRequest | BuyRequest | SellRequest;

// The venue that quoted leads the route; its legs are the route's shares.
function routeOf(
  quote: QuoteView,
  source: CardSource,
  request: TradeRequest,
): CardRoute | undefined {
  const [first] = quote.route;
  return first === undefined
    ? undefined
    : {
        venue: first.venue,
        legs: quote.route,
        priceImpactBps: quote.priceImpactBps,
        // The limits in effect when the card version opened, as its trade was quoted under them.
        maxSlippageBps: tradeSlippageBps(
          {
            pair: [quote.amountIn.asset, quote.minOut.asset],
            ...(request.maxSlippageBps === undefined ? {} : { asked: request.maxSlippageBps }),
          },
          limitsRecordAt(source.settings.limits, source.card.openedAtMs),
          source.chains,
        ),
      };
}

function checkOf(
  simulation: SimulationView | undefined,
  token: AssetRef,
  chains: ChainRegistry,
): CardCheck | undefined {
  // An estimate ran nothing, so the card has no simulation to show.
  const received =
    simulation?.estimated === true
      ? undefined
      : simulation?.received.find((amount) => amount.asset === token);
  return received === undefined
    ? undefined
    : { received, token, isTokenVerified: assetInfoOf(chains, token) !== undefined };
}

// The highest tax the risk step measured on the token the swap buys, for the card's tax line.
function taxOf(record: IntentRecord): Bps | undefined {
  const risk = record.risk === undefined ? undefined : riskDocument.decode(record.risk);
  const taxes = [risk?.buyTaxBps, risk?.sellTaxBps].filter((tax) => tax !== undefined);
  return taxes.reduce<Bps | undefined>(
    (max, tax) => (max === undefined || tax > max ? tax : max),
    undefined,
  );
}

// Where a buy or a sell runs: the launchpad's curve its quote names, or the pools of the venue
// that quoted.
function placeOf(quote: QuoteView): TradePlace {
  return quote.place?.kind === "curve"
    ? { curve: quote.place.launchpad }
    : { pool: quote.route[0]?.venue ?? "" };
}

// A trade's action line from its quote: what it spends and receives, and a buy's or a sell's
// place; a sale by share names its share.
function actionOf(request: TradeRequest, quote: QuoteView): CardAction {
  const { amountIn, minOut } = quote;
  if (request.kind === "buy") {
    return { kind: "buy", token: minOut.asset, spend: amountIn, place: placeOf(quote) };
  }
  if (request.kind === "swap") {
    return { kind: "swap", amountIn, minOut };
  }
  const sale = { kind: "sell", amount: amountIn, minOut, place: placeOf(quote) } as const;
  return "percentBps" in request.amount ? { ...sale, share: request.amount.percentBps } : sale;
}

// The token of a buy or a sell whose card version trades at another place than the one before.
function placeChangedToken(action: CardAction, source: CardSource): AssetRef | undefined {
  const { card, previous } = source;
  if (previous === undefined || isSamePlace(previous.place, card.place)) {
    return undefined;
  }
  if (action.kind === "buy") {
    return action.token;
  }
  return action.kind === "sell" ? action.amount.asset : undefined;
}

// Whether a venue on the trade's route declares no deadline on its chain (decision 0180).
function hasNoDeadline(quote: QuoteView, source: CardSource): boolean {
  const { chain } = assetRefParts(quote.amountIn.asset);
  return quote.route.some((leg) => source.venues.hasNoDeadline(leg.venue, chain));
}

function tradeFacts(request: TradeRequest, quote: QuoteView, source: CardSource): CardFacts {
  const { record, card, settings, isFirstLive, chains } = source;
  const action = actionOf(request, quote);
  const changedToken = placeChangedToken(action, source);
  const route = routeOf(quote, source, request);
  const simulation =
    record.simulation === undefined ? undefined : simulationDocument.decode(record.simulation);
  const check = checkOf(simulation, quote.minOut.asset, chains);
  const taxBps = taxOf(record);
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action,
    ...(route === undefined ? {} : { route }),
    ...(check === undefined ? {} : { check }),
    warnings: {
      hasUnusualName: false,
      isNewAddress: false,
      ...(isFirstLive ? { isFirstLive } : {}),
      ...(taxBps === undefined ? {} : { taxBps }),
      ...(simulation?.estimated === true ? { isEstimate: true } : {}),
      ...(changedToken === undefined ? {} : { placeChangedToken: changedToken }),
      ...(hasNoDeadline(quote, source) ? { hasNoDeadline: true } : {}),
    },
    reason: request.reason,
  };
}

// A rescue's card: where everything goes, how many tokens from how many wallets, and their value
// when quoted (spec 4, section 3.3). The owner asked for it, so no agent's reason shows.
function rescueFacts(quote: RescueQuote, source: CardSource): CardFacts {
  const { record, card, settings, chains } = source;
  const { moves, rescue, valueUsdMicros } = quote;
  const tokens = new Set(
    moves.map(({ amount }) => amount.asset).filter((asset) => !isNativeAsset(chains, asset)),
  );
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: {
      kind: "rescue",
      address: rescue,
      tokenCount: tokens.size,
      walletCount: new Set(moves.map(({ from }) => from)).size,
      valueUsdMicros,
    },
    warnings: { hasUnusualName: false, isNewAddress: false },
  };
}

// An unfreeze's card: the agent it unfreezes, or how many agents are frozen when it unfreezes the
// whole install (decision 0128). The owner asked for it, so no agent's reason shows.
function unfreezeFacts(quote: UnfreezeQuote, source: CardSource): CardFacts {
  const { record, card, settings } = source;
  const [only] = quote.agents;
  const action =
    quote.isWholeInstall || only === undefined
      ? ({ kind: "unfreeze", scope: "install", agentCount: quote.agents.length } as const)
      : ({ kind: "unfreeze", scope: "agent", agent: only.name } as const);
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action,
    warnings: { hasUnusualName: false, isNewAddress: false },
  };
}

// An auto order's card: its terms with every default filled, the agent's reason, and the line on
// linked exits when its position holds another active exit order (decision 0189). DCA and copy
// orders are refused before any card.
function autoOrderFacts(quote: AutoOrderQuote, source: CardSource): CardFacts | undefined {
  const { record, card, settings } = source;
  const { request, hasLinkedExits, maxFills, expiresAtMs } = quote;
  if (request.kind === "dca" || request.kind === "copy") {
    return undefined;
  }
  const { reason } = request;
  const isLinked = hasLinkedExits && isExitOrder(request);
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: {
      kind: "autoOrder",
      request,
      ...(maxFills === undefined ? {} : { maxFills }),
      expiresAtMs,
    },
    warnings: {
      hasUnusualName: false,
      isNewAddress: false,
      ...(isLinked ? { exitsLinkedToken: request.token } : {}),
    },
    ...(reason === undefined ? {} : { reason }),
  };
}

// The kinds whose quote is a document of their own, each with the facts its card draws from it.
const ownQuoteFacts: ReadonlyMap<
  IntentKind,
  (quote: JsonValue, source: CardSource) => CardFacts | undefined
> = new Map([
  ["rescue", (quote, source) => rescueFacts(rescueQuoteDocument.decode(quote), source)],
  ["unfreeze", (quote, source) => unfreezeFacts(unfreezeQuoteDocument.decode(quote), source)],
  ["autoOrder", (quote, source) => autoOrderFacts(autoOrderQuoteDocument.decode(quote), source)],
]);

/**
 * The facts a card version is drawn from (spec 4, section 3), read from the stored intent: the
 * quote's amounts and route, a buy's or a sell's place, whether a venue on the route declares no
 * deadline, the simulation's check (or that a paper
 * sale's fill is an estimate), the highest tax the risk step measured and the agent's reason; for
 * a rescue, its address, what it moves and their value; for an unfreeze, what it unfreezes; for an
 * auto order, its terms. The money path quotes trades, rescues, unfreezes and auto orders only,
 * so an intent of another kind, or one without a quote, has none. The fees line waits for a gas
 * estimate in the quote, and no source marks unusual names yet.
 */
export function cardFactsOf(source: CardSource): CardFacts | undefined {
  const { record } = source;
  const { quote } = record;
  const own = ownQuoteFacts.get(record.kind);
  if (own !== undefined) {
    return quote === undefined ? undefined : own(quote, source);
  }
  const request = requestDocument.decode(record.request);
  const isTrade = request.kind === "swap" || request.kind === "buy" || request.kind === "sell";
  if (!isTrade || quote === undefined) {
    return undefined;
  }
  return tradeFacts(request, quoteDocument.decode(quote), source);
}
