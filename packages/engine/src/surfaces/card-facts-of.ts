import type { AssetRef, ChainRegistry } from "@binference/chain";
import type { QuoteView, SimulationView, SwapRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { CardCheck, CardFacts, CardRoute } from "../confirmations/draw-card.js";
import type { CardRecord } from "../intents/card-record.js";
import {
  quoteDocument,
  requestDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { swapSlippageBps } from "../money-path/swap-trade.js";

/** What a card version's facts are read from: the stored intent, the version and its agent. */
export interface CardSource {
  readonly record: IntentRecord;
  readonly card: CardRecord;
  readonly settings: AgentSettings;
  /** Whether the card is the agent's first live card (`isFirstLiveCard`). */
  readonly isFirstLive: boolean;
  readonly chains: ChainRegistry;
}

// The venue that quoted leads the route; its legs are the route's shares.
function routeOf(
  quote: QuoteView,
  source: CardSource,
  request: SwapRequest,
): CardRoute | undefined {
  const [first] = quote.route;
  return first === undefined
    ? undefined
    : {
        venue: first.venue,
        legs: quote.route,
        priceImpactBps: quote.priceImpactBps,
        maxSlippageBps: swapSlippageBps(request, source.settings.limits, source.chains),
      };
}

function checkOf(
  simulation: SimulationView | undefined,
  token: AssetRef,
  chains: ChainRegistry,
): CardCheck | undefined {
  const received = simulation?.received.find((amount) => amount.asset === token);
  return received === undefined
    ? undefined
    : { received, token, isTokenVerified: assetInfoOf(chains, token) !== undefined };
}

function swapFacts(request: SwapRequest, quote: QuoteView, source: CardSource): CardFacts {
  const { record, card, settings, isFirstLive, chains } = source;
  const route = routeOf(quote, source, request);
  const simulation =
    record.simulation === undefined ? undefined : simulationDocument.decode(record.simulation);
  const check = checkOf(simulation, request.to, chains);
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: { kind: "swap", amountIn: quote.amountIn, minOut: quote.minOut },
    ...(route === undefined ? {} : { route }),
    ...(check === undefined ? {} : { check }),
    warnings: {
      hasUnusualName: false,
      isNewAddress: false,
      ...(isFirstLive ? { isFirstLive } : {}),
    },
    reason: request.reason,
  };
}

/**
 * The facts a card version is drawn from (spec 4, section 3), read from the stored intent: the
 * quote's amounts and route, the simulation's check and the agent's reason. The money path quotes
 * swaps only, so an intent of another kind, or one without a quote, has none. The fees line waits
 * for a gas estimate in the quote, and no source marks unusual names yet.
 */
export function cardFactsOf(source: CardSource): CardFacts | undefined {
  const { record } = source;
  const request = requestDocument.decode(record.request);
  if (request.kind !== "swap" || record.quote === undefined) {
    return undefined;
  }
  return swapFacts(request, quoteDocument.decode(record.quote), source);
}
