import type { AssetRef, ChainRegistry } from "@binference/chain";
import type {
  CardView,
  IntentOutcome,
  IntentRequest,
  IntentView,
  RescueRequest,
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
import { assetInfosOf } from "../money-path/asset-infos.js";

// The money path routes swaps; a rescue lists what it moves; other kinds list their assets once
// it runs them.
function assetsOf(
  record: IntentRecord,
  request: IntentRequest | RescueRequest,
): readonly AssetRef[] {
  if (request.kind === "rescue") {
    const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
    return [...new Set(quote?.moves.map(({ amount }) => amount.asset) ?? [])];
  }
  return request.kind === "swap" ? [request.from, request.to] : [];
}

// A rescue's quote is its own document, which the view's quote does not show.
function requestOf(record: IntentRecord): IntentRequest | RescueRequest {
  return record.kind === "rescue" ? rescueRequest : requestDocument.decode(record.request);
}

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
    ...(record.quote === undefined || record.kind === "rescue"
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
