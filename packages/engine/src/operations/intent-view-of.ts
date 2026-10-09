import type { AssetRef, ChainRegistry } from "@binference/chain";
import type { CardView, IntentOutcome, IntentRequest, IntentView } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import {
  quoteDocument,
  requestDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import { paperFillOf, settledTradeOf } from "../intents/intent-history.js";
import { assetInfosOf } from "../money-path/asset-infos.js";

// The money path routes swaps; other kinds list their assets once it runs them.
function assetsOf(request: IntentRequest): readonly AssetRef[] {
  return request.kind === "swap" ? [request.from, request.to] : [];
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
 * An intent as every surface draws it (protocol spec, section 8.3): the stored record, its quote
 * and simulation, its newest card version, its outcome with the paper fill or the settled trade as
 * its execution, and the registry's info for the assets it names.
 */
export function intentViewOf(snapshot: IntentSnapshot, chains: ChainRegistry): IntentView {
  const { record } = snapshot;
  const request = requestDocument.decode(record.request);
  const card = cardViewOf(snapshot);
  const outcome = outcomeOf(snapshot);
  return {
    intent: record.id,
    agent: record.agentId,
    wallet: record.walletId,
    kind: record.kind,
    state: record.state,
    request,
    ...(record.quote === undefined ? {} : { quote: quoteDocument.decode(record.quote) }),
    ...(record.simulation === undefined
      ? {}
      : { simulation: simulationDocument.decode(record.simulation) }),
    ...(card === undefined ? {} : { card }),
    ...(outcome === undefined ? {} : { outcome }),
    paper: record.isPaper,
    outsideContent: record.hasOutsideContent,
    createdAt: record.createdAtMs,
    changedAt: record.changedAtMs,
    assets: assetInfosOf(chains, assetsOf(request)),
  };
}
