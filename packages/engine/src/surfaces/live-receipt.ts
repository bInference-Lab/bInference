import {
  accountRefParts,
  type Amount,
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type ChainRegistry,
  type TxHash,
} from "@binference/chain";
import { type AssetInfos, unsentEndStates } from "@binference/protocol";
import type { LiveOutcome, ReceiptTx } from "../confirmations/card-closing.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { type IntentHistory, settledTradeOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
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
// lists for it, or its hash when the registry lists no explorer for the chain.
function txOf(chains: ChainRegistry, chain: ChainRef, hash: TxHash): ReceiptTx {
  const registered = chains.get(chain);
  const explorer = registered.ok ? registered.value.definition.explorers[0] : undefined;
  return explorer === undefined
    ? { hash }
    : { explorerLink: explorer.txUrl.replace("{hash}", hash) };
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
  const tx = txOf(chains, assetRefParts(amountIn.asset).chain, hash);
  const fill = { amountIn, amountOut };
  const assets = intentAssetInfos(chains, record, [amountIn.asset, amountOut.asset]);
  if (record.kind !== "launchToken") {
    return { outcome: { kind: "filled", fill, tx }, assets };
  }
  const outcome = launchedOf(record, { amountOut, tx });
  return { outcome, assets: { ...assets, ...intentAssetInfos(chains, record, [outcome.token]) } };
}

// A launch's token, and its first buy: what the request names, which the create call pays exactly
// (decision 0235), since the settled spend holds the launch fee too, and what it got, which is
// none of the token when the buy bought nothing (Flap's first buy has no minimum, decision 0270).
function launchedOf(
  record: IntentRecord,
  settled: { readonly amountOut: Amount; readonly tx: ReceiptTx },
): Extract<LiveOutcome, { readonly kind: "launched" }> {
  const { amountOut, tx } = settled;
  const request = requestDocument.decode(record.request);
  const spend = request.kind === "launchToken" ? request.firstBuy : undefined;
  const token: AssetRef =
    record.quote === undefined
      ? amountOut.asset
      : tokenLaunchQuoteDocument.decode(record.quote).token;
  if (spend === undefined) {
    return { kind: "launched", token, tx };
  }
  const got = amountOut.asset === token ? amountOut : { asset: token, base: 0n };
  return { kind: "launched", token, fill: { amountIn: spend, amountOut: got }, tx };
}

// A live intent that reconciled with no trade to show, such as a send or a rescue, or a launch with
// none recorded: its last transaction. `undefined` when it sent none.
async function landedOf(
  source: LiveReceiptSource,
  call: { readonly signal: AbortSignal },
): Promise<LiveReceipt | undefined> {
  const { record, transactions, chains } = source;
  const last = (await transactions.ofIntent(record.id, call)).at(-1);
  return last === undefined
    ? undefined
    : {
        outcome: {
          kind: "landed",
          tx: txOf(chains, accountRefParts(last.account).chain, last.hash),
        },
        assets: {},
      };
}

// A confirmed intent that reconciled with nothing sent on chain, such as an auto order's card
// whose order can no longer be drawn.
const doneAlone: LiveReceipt = { outcome: { kind: "done" }, assets: {} };

// A confirmed intent that ended before anything was sent: why, when it stored a reason.
function unsentOf(record: IntentRecord): LiveReceipt {
  const { reason } = record;
  const outcome: LiveOutcome =
    reason === undefined ? { kind: "unsent" } : { kind: "refused", reason };
  return { outcome, assets: {} };
}

// A live intent that failed on chain: its reason, and its last transaction.
async function failedOf(
  source: LiveReceiptSource,
  call: { readonly signal: AbortSignal },
): Promise<LiveReceipt | undefined> {
  const { record, transactions, chains } = source;
  const last = (await transactions.ofIntent(record.id, call)).at(-1);
  if (last === undefined || record.reason === undefined) {
    return undefined;
  }
  const tx = txOf(chains, accountRefParts(last.account).chain, last.hash);
  return { outcome: { kind: "failed", reason: record.reason, tx }, assets: {} };
}

/**
 * How a confirmed live intent ended, once it did (spec 4, section 3.5): `reconciled` with the
 * trade it recorded, as landed with none, or as done with nothing sent; `failed_onchain` with its
 * reason; each with its last transaction's explorer link, or its hash on a chain the registry
 * lists no explorer for; an end before anything was sent, with
 * its reason when it stored one, which a paper intent that ended before its fill gives too; and
 * `unknown_after_send` while the chain is read. `undefined` for any other paper intent and one
 * still on its way.
 */
export async function liveReceiptOf(
  source: LiveReceiptSource,
  call: { readonly signal: AbortSignal },
): Promise<LiveReceipt | undefined> {
  const { record } = source;
  if (unsentEndStates.has(record.state)) {
    return unsentOf(record);
  }
  if (record.isPaper) {
    return undefined;
  }
  if (record.state === "reconciled") {
    return reconciledOf(source) ?? (await landedOf(source, call)) ?? doneAlone;
  }
  if (record.state === "failed_onchain") {
    return failedOf(source, call);
  }
  return record.state === "unknown_after_send"
    ? { outcome: { kind: "unknown" }, assets: {} }
    : undefined;
}
