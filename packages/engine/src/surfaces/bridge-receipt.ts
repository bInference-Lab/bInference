import { assetRefParts, type ChainRef, type ChainRegistry, type TxHash } from "@binference/chain";
import type { BridgeRecord } from "../bridges/bridge-record.js";
import { bridgeAssetsOf, walletLabelOf } from "../bridges/bridge-settlement.js";
import type { BridgeOutcome } from "../confirmations/card-closing.js";
import { type BridgeIntentQuote, bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { LiveReceipt, LiveReceiptSource } from "./live-receipt.js";
import { receiptTxOf } from "./receipt-tx.js";

interface Call {
  readonly signal: AbortSignal;
}

// A chain as a receipt names it: the registry's name, or its reference when the registry lacks it.
function chainName(chains: ChainRegistry, chain: ChainRef): string {
  const registered = chains.get(chain);
  return registered.ok ? registered.value.definition.name : chain;
}

// On its way once its deposit is final: the deposit its row holds, else the intent's last
// transaction, which is the plan's last step, before the follower's row opens.
async function sentOf(
  source: LiveReceiptSource,
  context: { readonly quote: BridgeIntentQuote; readonly bridge: BridgeRecord | undefined },
  call: Call,
): Promise<BridgeOutcome | undefined> {
  const { record, transactions, chains } = source;
  const { quote, bridge } = context;
  const deposit: TxHash | undefined =
    bridge?.depositTx ?? (await transactions.ofIntent(record.id, call)).at(-1)?.hash;
  if (deposit === undefined) {
    return undefined;
  }
  const from = assetRefParts(quote.amount.asset).chain;
  return {
    kind: "bridgeSent",
    fromChain: chainName(chains, from),
    chain: quote.chainName,
    minutes: Math.max(1, Math.ceil(quote.etaSeconds / 60)),
    tx: receiptTxOf(chains, from, deposit),
  };
}

// Settled by a read: the delivery, with the transaction that paid the recipient on its chain, or
// the refund, with the one that paid the wallet back on the chain the deposit left.
async function settledOf(
  source: LiveReceiptSource,
  context: { readonly quote: BridgeIntentQuote; readonly bridge: BridgeRecord },
  call: Call,
): Promise<BridgeOutcome | undefined> {
  const { record, chains, install } = source;
  const { quote, bridge } = context;
  const { received, fillTx, refundTx } = bridge;
  if (received === undefined) {
    return undefined;
  }
  if (bridge.state === "delivered" && fillTx !== undefined) {
    const { label, isRescue } = quote;
    return {
      kind: "bridgeDelivered",
      chain: quote.chainName,
      recipient: bridge.recipient,
      payee: {
        ...(label === undefined ? {} : { label }),
        ...(isRescue === undefined ? {} : { isRescue }),
      },
      received,
      tx: receiptTxOf(chains, bridge.toChain, fillTx),
    };
  }
  if (bridge.state !== "refunded" || refundTx === undefined) {
    return undefined;
  }
  const from = assetRefParts(bridge.sent.asset).chain;
  return {
    kind: "bridgeRefunded",
    venue: quote.venue,
    amount: received,
    wallet: await walletLabelOf(install, record.walletId, call.signal),
    tx: receiptTxOf(chains, from, refundTx),
  };
}

/**
 * Where a confirmed live bridge stands, as its receipt shows it (spec 4, section 3.9): on its way
 * once its deposit is final (`finalized`), then delivered or paid back once a read settled it
 * (`reconciled`), each with its transaction's explorer link on the chain it ran on, or its hash
 * where the registry lists no explorer. `undefined` for any other state, a bridge with no quote,
 * and one whose deposit or settlement is not stored, which the other receipts then show.
 */
export async function bridgeReceiptOf(
  source: LiveReceiptSource,
  call: Call,
): Promise<LiveReceipt | undefined> {
  const { record, bridges, chains } = source;
  const isShown = record.state === "finalized" || record.state === "reconciled";
  if (!isShown || record.quote === undefined) {
    return undefined;
  }
  const quote = bridgeQuoteDocument.decode(record.quote);
  const bridge = await bridges?.get(record.id, call);
  const outcome =
    record.state === "finalized"
      ? await sentOf(source, { quote, bridge }, call)
      : bridge && (await settledOf(source, { quote, bridge }, call));
  if (outcome === undefined) {
    return undefined;
  }
  const received = bridge?.received === undefined ? [] : [bridge.received.asset];
  const assets = {
    ...bridgeAssetsOf(chains, { record }, quote),
    ...intentAssetInfos(chains, record, received),
  };
  return { outcome, assets };
}
