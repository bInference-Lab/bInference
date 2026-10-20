import {
  accountRefParts,
  type Amount,
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type ChainRegistry,
  type TxHash,
} from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";
import type { LiveOutcome } from "../confirmations/card-closing.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { type IntentHistory, settledTradeOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { IntentState } from "../intents/intent-state.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { TransactionStore } from "../ports.js";

/** How a confirmed live intent ended on chain, with the assets its receipt names. */
export interface LiveReceipt {
  readonly outcome: LiveOutcome;
  readonly assets: AssetInfos;
}

/** What a live receipt reads: the intent, its history, its transactions and the registry. */
export interface LiveReceiptSource {
  readonly record: IntentRecord;
  readonly history: IntentHistory;
  readonly transactions: Pick<TransactionStore, "ofIntent">;
  readonly chains: ChainRegistry;
}

// A transaction's page on the chain's first block explorer, from the page template the registry
// lists for it.
function explorerLinkOf(chains: ChainRegistry, chain: ChainRef, hash: TxHash): string | undefined {
  const registered = chains.get(chain);
  const explorer = registered.ok ? registered.value.definition.explorers[0] : undefined;
  return explorer?.txUrl.replace("{hash}", hash);
}

// A trade that reconciled: what it sold and bought; a launch: its token, and its first buy's.
function reconciledOf(source: LiveReceiptSource): LiveReceipt | undefined {
  const { record, history, chains } = source;
  const settled = settledTradeOf(history);
  const hash = settled?.txHashes.at(-1);
  if (settled === undefined || hash === undefined) {
    return undefined;
  }
  const { amountIn, amountOut } = settled;
  const explorerLink = explorerLinkOf(chains, assetRefParts(amountIn.asset).chain, hash);
  if (explorerLink === undefined) {
    return undefined;
  }
  const fill = { amountIn, amountOut };
  const assets = intentAssetInfos(chains, record, [amountIn.asset, amountOut.asset]);
  if (record.kind !== "launchToken") {
    return { outcome: { kind: "filled", fill, explorerLink }, assets };
  }
  const outcome = launchedOf(record, { amountOut, explorerLink });
  return { outcome, assets: { ...assets, ...intentAssetInfos(chains, record, [outcome.token]) } };
}

// A launch's token, and its first buy: what the request names, which the create call pays exactly
// (decision 0235), since the settled spend holds the launch fee too, and what it got, which is
// none of the token when the buy bought nothing (Flap's first buy has no minimum, decision 0270).
function launchedOf(
  record: IntentRecord,
  settled: { readonly amountOut: Amount; readonly explorerLink: string },
): Extract<LiveOutcome, { readonly kind: "launched" }> {
  const { amountOut, explorerLink } = settled;
  const request = requestDocument.decode(record.request);
  const spend = request.kind === "launchToken" ? request.firstBuy : undefined;
  const token: AssetRef =
    record.quote === undefined
      ? amountOut.asset
      : tokenLaunchQuoteDocument.decode(record.quote).token;
  if (spend === undefined) {
    return { kind: "launched", token, explorerLink };
  }
  const got = amountOut.asset === token ? amountOut : { asset: token, base: 0n };
  return { kind: "launched", token, fill: { amountIn: spend, amountOut: got }, explorerLink };
}

// A live intent that reconciled with no trade to show, such as a send or a rescue, or a launch with
// none recorded: its last transaction's explorer link.
async function landedOf(
  source: LiveReceiptSource,
  call: { readonly signal: AbortSignal },
): Promise<LiveReceipt | undefined> {
  const { record, transactions, chains } = source;
  const last = (await transactions.ofIntent(record.id, call)).at(-1);
  const explorerLink =
    last === undefined
      ? undefined
      : explorerLinkOf(chains, accountRefParts(last.account).chain, last.hash);
  return explorerLink === undefined
    ? undefined
    : { outcome: { kind: "landed", explorerLink }, assets: {} };
}

// The ends of a confirmed intent before anything was sent: a check or policy refusal at the queue,
// a cancel, or an authorization that lapsed.
const unsentStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "failed_check",
  "rejected_policy",
  "risk_blocked",
  "cancelled",
  "expired",
]);

// A confirmed intent that reconciled with nothing sent on chain, such as an unfreeze.
const doneAlone: LiveReceipt = { outcome: { kind: "done" }, assets: {} };

// A confirmed intent that ended before anything was sent: why, when it stored a reason.
function unsentOf(record: IntentRecord): LiveReceipt {
  const { reason } = record;
  const outcome: LiveOutcome =
    reason === undefined ? { kind: "unsent" } : { kind: "refused", reason };
  return { outcome, assets: {} };
}

// A live intent that failed on chain: its reason, and its last transaction's explorer link.
async function failedOf(
  source: LiveReceiptSource,
  call: { readonly signal: AbortSignal },
): Promise<LiveReceipt | undefined> {
  const { record, transactions, chains } = source;
  const last = (await transactions.ofIntent(record.id, call)).at(-1);
  if (last === undefined || record.reason === undefined) {
    return undefined;
  }
  const explorerLink = explorerLinkOf(chains, accountRefParts(last.account).chain, last.hash);
  return explorerLink === undefined
    ? undefined
    : { outcome: { kind: "failed", reason: record.reason, explorerLink }, assets: {} };
}

/**
 * How a confirmed live intent ended, once it did (spec 4, section 3.5): `reconciled` with the
 * trade it recorded, as landed with none, or as done with nothing sent; `failed_onchain` with its
 * reason; each with its last transaction's explorer link; an end before anything was sent, with
 * its reason when it stored one; and `unknown_after_send` while the chain is read. `undefined`
 * for a paper intent and one still on its way.
 */
export async function liveReceiptOf(
  source: LiveReceiptSource,
  call: { readonly signal: AbortSignal },
): Promise<LiveReceipt | undefined> {
  const { record } = source;
  if (record.isPaper) {
    return undefined;
  }
  if (record.state === "reconciled") {
    return reconciledOf(source) ?? (await landedOf(source, call)) ?? doneAlone;
  }
  if (record.state === "failed_onchain") {
    return failedOf(source, call);
  }
  if (record.state === "unknown_after_send") {
    return { outcome: { kind: "unknown" }, assets: {} };
  }
  return unsentStates.has(record.state) ? unsentOf(record) : undefined;
}
