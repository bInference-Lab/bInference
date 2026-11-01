import {
  accountRefParts,
  type Amount,
  type AssetRef,
  assetRefParts,
  type ChainRegistry,
} from "@binference/chain";
import { type AssetInfos, unsentEndStates } from "@binference/protocol";
import type { DestinationChain } from "../address-book/destination-chain.js";
import type { BridgeStore } from "../bridges/ports.js";
import type { LiveOutcome, ReceiptTx } from "../confirmations/card-closing.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { type IntentHistory, settledTradeOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { InstallStore, TransactionStore } from "../ports.js";
import { bridgeReceiptOf } from "./bridge-receipt.js";
import { receiptTxOf } from "./receipt-tx.js";

/** How a confirmed live intent ended on chain, with the assets its receipt names. */
export interface LiveReceipt {
  readonly outcome: LiveOutcome;
  readonly assets: AssetInfos;
}

/**
 * What a live receipt reads: the intent, its history, its transactions and the registry; for a
 * bridge, its delivery, the install's wallets, whose label a refund names, and the chains bridges
 * deliver to, whose explorer a delivery links to.
 */
export interface LiveReceiptSource {
  readonly record: IntentRecord;
  readonly history: IntentHistory;
  readonly transactions: Pick<TransactionStore, "ofIntent">;
  readonly chains: ChainRegistry;
  readonly bridges?: Pick<BridgeStore, "get"> | undefined;
  readonly install: Pick<InstallStore, "read">;
  readonly destinations?: readonly DestinationChain[] | undefined;
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
  const tx = receiptTxOf(chains, assetRefParts(amountIn.asset).chain, hash);
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
          tx: receiptTxOf(chains, accountRefParts(last.account).chain, last.hash),
        },
        assets: {},
      };
}

// A confirmed intent that reconciled with nothing sent on chain, such as an auto order's card
// whose order can no longer be drawn.
const doneAlone: LiveReceipt = { outcome: { kind: "done" }, assets: {} };

// A confirmed intent that ended before anything was sent: why, when it stored a reason, with a send
// by name's name, which a name's reasons name.
function unsentOf(record: IntentRecord): LiveReceipt {
  const { reason, kind, quote } = record;
  if (reason === undefined) {
    return { outcome: { kind: "unsent" }, assets: {} };
  }
  const name =
    kind === "send" && quote !== undefined ? sendQuoteDocument.decode(quote).name?.name : undefined;
  const refused = { kind: "refused", reason } as const;
  return { outcome: name === undefined ? refused : { ...refused, name }, assets: {} };
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
  const tx = receiptTxOf(chains, accountRefParts(last.account).chain, last.hash);
  return { outcome: { kind: "failed", reason: record.reason, tx }, assets: {} };
}

/**
 * How a confirmed live intent ended, once it did (spec 4, section 3.5): `reconciled` with the
 * trade it recorded, as landed with none, or as done with nothing sent; `failed_onchain` with its
 * reason; each with its last transaction's explorer link, or its hash on a chain the registry
 * lists no explorer for; an end before anything was sent, with
 * its reason when it stored one, which a paper intent that ended before its fill gives too; and
 * `unknown_after_send` while the chain is read. A bridge says where it stands from its final
 * deposit on (section 3.9): on its way, then delivered or paid back. `undefined` for any other
 * paper intent and one still on its way.
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
  const bridged = record.kind === "bridge" ? await bridgeReceiptOf(source, call) : undefined;
  if (bridged !== undefined) {
    return bridged;
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
