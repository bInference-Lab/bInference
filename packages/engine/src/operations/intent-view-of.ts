import type { AssetRef, ChainRegistry } from "@binference/chain";
import type {
  CardView,
  IntentOutcome,
  IntentRequest,
  IntentView,
  RescueRequest,
  UnfreezeRequest,
} from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import {
  quoteDocument,
  requestDocument,
  riskDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import { paperFillOf, settledTradeOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { rescueQuoteDocument, rescueRequest } from "../intents/rescue-quote.js";
import { unfreezeRequestDocument } from "../intents/unfreeze-quote.js";
import { assetInfosOf } from "../money-path/asset-infos.js";

/** What an intent was asked: a proposal's request, a rescue's or an unfreeze's. */
type AnyRequest = IntentRequest | RescueRequest | UnfreezeRequest;

// The assets a trade asks for: a sale's receive, when it leaves it to its place, is its quote's.
function tradeAssetsOf(request: AnyRequest): readonly AssetRef[] {
  if (request.kind === "swap") {
    return [request.from, request.to];
  }
  if (request.kind === "buy") {
    return [request.spend.asset, request.token];
  }
  if (request.kind !== "sell") {
    return [];
  }
  return request.receive === undefined ? [request.token] : [request.token, request.receive];
}

// The money path routes trades, whose quote names what it spends and buys; a rescue lists what it
// moves; other kinds list their assets once it runs them, and an unfreeze moves none.
function assetsOf(record: IntentRecord, request: AnyRequest): readonly AssetRef[] {
  if (request.kind === "rescue") {
    const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
    return [...new Set(quote?.moves.map(({ amount }) => amount.asset) ?? [])];
  }
  const asked = tradeAssetsOf(request);
  if (asked.length === 0 || record.quote === undefined) {
    return asked;
  }
  const { amountIn, minOut } = quoteDocument.decode(record.quote);
  return [...new Set([...asked, amountIn.asset, minOut.asset])];
}

// A rescue's or an unfreeze's quote is its own document, which the view's quote does not show.
function requestOf(record: IntentRecord): AnyRequest {
  if (record.kind === "unfreeze") {
    return unfreezeRequestDocument.decode(record.request);
  }
  return record.kind === "rescue" ? rescueRequest : requestDocument.decode(record.request);
}

// Only a trade's quote is a `QuoteView`.
const ownQuoteKinds: ReadonlySet<string> = new Set(["rescue", "unfreeze"]);

function cardViewOf(snapshot: IntentSnapshot): CardView | undefined {
  const card = snapshot.history.cards.at(-1);
  const { record } = snapshot;
  return card === undefined
    ? undefined
    : {
        card: card.id,
        version: card.version,
        opensAt: card.openedAtMs,
        expiresAt: card.expiresAtMs,
        paper: record.isPaper,
        outsideContent: record.hasOutsideContent,
      };
}

// A paper intent's fill, or a live intent's settled trade with its transactions' hashes.
function executionOf(snapshot: IntentSnapshot): Omit<IntentOutcome, "reason"> {
  const settled = settledTradeOf(snapshot.history);
  if (settled !== undefined) {
    const { amountIn, amountOut, atMs, txHashes } = settled;
    return { txHashes, executions: [{ amountIn, amountOut, at: atMs }] };
  }
  const fill = paperFillOf(snapshot.history);
  return fill === undefined
    ? {}
    : { executions: [{ amountIn: fill.amountIn, amountOut: fill.amountOut, at: fill.atMs }] };
}

function outcomeOf(snapshot: IntentSnapshot): IntentOutcome | undefined {
  const { reason } = snapshot.record;
  const execution = executionOf(snapshot);
  if (reason === undefined && execution.executions === undefined) {
    return undefined;
  }
  return { ...(reason === undefined ? {} : { reason }), ...execution };
}

/**
 * An intent as every surface draws it (protocol spec, section 8.3): the stored record, its quote,
 * risk check and simulation, its newest card version, its outcome with the paper fill or the
 * settled trade as its execution, and the registry's info for the assets it names.
 */
export function intentViewOf(snapshot: IntentSnapshot, chains: ChainRegistry): IntentView {
  const { record } = snapshot;
  const request = requestOf(record);
  const card = cardViewOf(snapshot);
  const outcome = outcomeOf(snapshot);
  return {
    intent: record.id,
    agent: record.agentId,
    wallet: record.walletId,
    kind: record.kind,
    state: record.state,
    request,
    ...(record.quote === undefined || ownQuoteKinds.has(record.kind)
      ? {}
      : { quote: quoteDocument.decode(record.quote) }),
    ...(record.risk === undefined ? {} : { risk: riskDocument.decode(record.risk) }),
    ...(record.simulation === undefined
      ? {}
      : { simulation: simulationDocument.decode(record.simulation) }),
    ...(card === undefined ? {} : { card }),
    ...(outcome === undefined ? {} : { outcome }),
    paper: record.isPaper,
    outsideContent: record.hasOutsideContent,
    createdAt: record.createdAtMs,
    changedAt: record.changedAtMs,
    assets: assetInfosOf(chains, assetsOf(record, request)),
  };
}
