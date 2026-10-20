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

// A transaction's page on the chain's first block explorer, which the registry lists for each chain.
function explorerLinkOf(chains: ChainRegistry, chain: ChainRef, hash: TxHash): string | undefined {
  const registered = chains.get(chain);
  const explorer = registered.ok ? registered.value.definition.explorers[0] : undefined;
  return explorer === undefined ? undefined : `${explorer.url}/tx/${hash}`;
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
// (decision 0235), since the settled spend holds the launch fee too, and what it got.
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
  const isBought = spend !== undefined && amountOut.asset === token && amountOut.base > 0n;
  return isBought
    ? { kind: "launched", token, fill: { amountIn: spend, amountOut }, explorerLink }
    : { kind: "launched", token, explorerLink };
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
 * How a confirmed live intent ended on chain, once it did (spec 4, section 3.5): `reconciled`
 * with the trade it recorded, or as landed with none, or `failed_onchain` with its reason, each
 * with its last transaction's explorer link. `undefined` for a paper intent, one still on its way, or one with
 * no transaction or explorer to name.
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
    return reconciledOf(source) ?? landedOf(source, call);
  }
  return record.state === "failed_onchain" ? failedOf(source, call) : undefined;
}
