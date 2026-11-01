import type { AssetRef, ChainRegistry } from "@binference/chain";
import type {
  AutoOrderRequest,
  CardView,
  IntentOutcome,
  IntentRequest,
  IntentView,
  LaunchTokenRequest,
  RescueRequest,
  UnfreezeRequest,
} from "@binference/protocol";
import type { DestinationChain } from "../address-book/destination-chain.js";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
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
import { revokeQuoteDocument } from "../intents/revoke-quote.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { unfreezeRequestDocument } from "../intents/unfreeze-quote.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import { autoOrderQuoteDocument, autoOrderRequestDocument } from "../orders/auto-order-quote.js";
import type { DeliveryView } from "./delivery-view-of.js";

/** What an intent was asked: a proposal's request, a rescue's, an unfreeze's or an auto order's. */
type AnyRequest = IntentRequest | RescueRequest | UnfreezeRequest | AutoOrderRequest;

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

// A launch names what it pairs with and, once built, the token its create call makes.
function launchAssetsOf(record: IntentRecord, request: LaunchTokenRequest): readonly AssetRef[] {
  const { quote } = record;
  return quote === undefined
    ? [request.pairWith]
    : [request.pairWith, tokenLaunchQuoteDocument.decode(quote).token];
}

// What a send sends or the token a revoke frees, as its quote spells it once it has one.
function transferAssetOf(
  record: IntentRecord,
  request: Extract<AnyRequest, { kind: "send" | "revokeApproval" }>,
): AssetRef {
  const { quote } = record;
  if (request.kind === "send") {
    return quote === undefined
      ? request.amount.asset
      : sendQuoteDocument.decode(quote).amount.asset;
  }
  return quote === undefined ? request.token : revokeQuoteDocument.decode(quote).token;
}

// What a bridge sends and, once quoted, what it delivers and the coin a fill may pay instead.
function bridgeAssetsOf(
  record: IntentRecord,
  request: Extract<AnyRequest, { kind: "bridge" }>,
): readonly AssetRef[] {
  if (record.quote === undefined) {
    return [request.amount.asset];
  }
  const { amount, minOut, deliveredAsCoin } = bridgeQuoteDocument.decode(record.quote);
  return deliveredAsCoin === undefined
    ? [amount.asset, minOut.asset]
    : [amount.asset, minOut.asset, deliveredAsCoin];
}

// A kind whose quote is a document of its own: a rescue lists what it moves, an auto order its
// token and a launch its pair and token; a send names what it sends and a revoke the token it
// frees. `undefined` for a trade and the kinds the money path does not route.
function ownAssetsOf(record: IntentRecord, request: AnyRequest): readonly AssetRef[] | undefined {
  if (request.kind === "send" || request.kind === "revokeApproval") {
    return [transferAssetOf(record, request)];
  }
  if (request.kind === "rescue") {
    const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
    return [...new Set(quote?.moves.map(({ amount }) => amount.asset) ?? [])];
  }
  if (request.kind === "autoOrder") {
    return record.quote === undefined
      ? []
      : [autoOrderQuoteDocument.decode(record.quote).request.token];
  }
  return request.kind === "launchToken" ? launchAssetsOf(record, request) : undefined;
}

// A trade's quote names what it spends and buys; other kinds list their assets once the money path
// runs them, and an unfreeze moves none.
function assetsOf(record: IntentRecord, request: AnyRequest): readonly AssetRef[] {
  if (request.kind === "bridge") {
    return bridgeAssetsOf(record, request);
  }
  const own = ownAssetsOf(record, request);
  if (own !== undefined) {
    return own;
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
  if (record.kind === "autoOrder") {
    return autoOrderRequestDocument.decode(record.request);
  }
  return record.kind === "rescue" ? rescueRequest : requestDocument.decode(record.request);
}

// Only a trade's quote is a `QuoteView`.
const ownQuoteKinds: ReadonlySet<string> = new Set([
  "send",
  "bridge",
  "revokeApproval",
  "rescue",
  "unfreeze",
  "autoOrder",
  "launchToken",
]);

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

/** What a view shows beyond the stored intent: a bridge's delivery, and the chains bridges reach. */
export interface ViewReads {
  /** The bridge's delivery, once its deposit is final. */
  readonly delivery?: DeliveryView | undefined;
  /** The chains bridges deliver to, whose name a bridge's reason gives. */
  readonly destinations?: readonly DestinationChain[] | undefined;
}

// The name of the chain a bridge's reason names: the chain it bridges to.
function chainNameOf(request: AnyRequest, reads: ViewReads): string | undefined {
  const toChain = request.kind === "bridge" ? request.toChain : undefined;
  return reads.destinations?.find((destination) => destination.ref === toChain)?.name;
}

function outcomeOf(
  snapshot: IntentSnapshot,
  context: { readonly request: AnyRequest; readonly reads: ViewReads },
): IntentOutcome | undefined {
  const { reason } = snapshot.record;
  const execution = executionOf(snapshot);
  if (reason === undefined && execution.executions === undefined) {
    return undefined;
  }
  const chain = reason === undefined ? undefined : chainNameOf(context.request, context.reads);
  return {
    ...(reason === undefined ? {} : { reason }),
    ...(chain === undefined ? {} : { chain }),
    ...execution,
  };
}

// A send by name's name and the address its card showed, from its quote (decision 0308).
function resolvedNameOf(record: IntentRecord): IntentView["resolvedName"] {
  if (record.kind !== "send" || record.quote === undefined) {
    return undefined;
  }
  const { name, recipient } = sendQuoteDocument.decode(record.quote);
  return name === undefined
    ? undefined
    : { name: name.name, address: recipient, resolvedAt: name.resolvedAtMs };
}

/**
 * An intent as every surface draws it (protocol spec, section 8.3): the stored record, its quote,
 * risk check and simulation, its newest card version, its outcome with the paper fill or the
 * settled trade as its execution, the info of the assets it names: the registry's, or what the
 * intent stored of an unlisted token at its proposal, a send by name's resolved name, and a
 * bridge's delivery when the caller read it, with the name of the chain a bridge's reason names.
 */
export function intentViewOf(
  snapshot: IntentSnapshot,
  chains: ChainRegistry,
  reads: ViewReads = {},
): IntentView {
  const { record } = snapshot;
  const { delivery } = reads;
  const request = requestOf(record);
  const card = cardViewOf(snapshot);
  const outcome = outcomeOf(snapshot, { request, reads });
  const resolvedName = resolvedNameOf(record);
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
    assets: intentAssetInfos(chains, record, assetsOf(record, request)),
    ...(resolvedName === undefined ? {} : { resolvedName }),
    ...(delivery === undefined ? {} : { delivery }),
  };
}
