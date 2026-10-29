import type { ChainRegistry } from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";
import { orderTermsOf } from "../confirmations/card-action.js";
import type { WrittenOutcome } from "../confirmations/card-closing.js";
import { assetsOfLine } from "../confirmations/card-line.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { unfreezeQuoteDocument } from "../intents/unfreeze-quote.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import { type AutoOrderQuote, autoOrderQuoteDocument } from "../orders/auto-order-quote.js";
import type { OrderStore } from "../orders/ports.js";
import type { AgentStore } from "../ports.js";
import { orderActionOf } from "./order-action-of.js";
import { unfreezeActionOf } from "./unfreeze-action-of.js";

/** What a confirmed intent with nothing to send took effect as, with the assets its receipt names. */
export interface WrittenReceipt {
  readonly outcome: WrittenOutcome;
  readonly assets: AssetInfos;
}

/** What a written receipt reads: the intent, its order, its agent's address book, the registry. */
export interface WrittenReceiptSource {
  readonly record: IntentRecord;
  readonly orders: Pick<OrderStore, "byIntent">;
  readonly agents: Pick<AgentStore, "get">;
  readonly chains: ChainRegistry;
}

interface Call {
  readonly signal: AbortSignal;
}

const noAssets: AssetInfos = {};

// An auto order's card took effect as the order it made active, which then kept the card's id, or
// as the order's end when the tap came after it: its expiry, or a cancel or freeze that won.
async function orderOutcomeOf(
  source: WrittenReceiptSource,
  quote: AutoOrderQuote,
  call: Call,
): Promise<WrittenReceipt | undefined> {
  const { record, orders, agents, chains } = source;
  const order = await orders.byIntent(record.id, call);
  if (order?.cardId === undefined) {
    const why = order?.state === "expired" ? "expired" : "cancelled";
    return { outcome: { kind: "orderUnstarted", why }, assets: noAssets };
  }
  const settings = await agents.get(record.agentId, call);
  const action = settings === undefined ? undefined : orderActionOf(quote, settings);
  if (action === undefined) {
    return undefined;
  }
  const named = assetsOfLine({ key: "receipt.orderActive", values: orderTermsOf(action) });
  return {
    outcome: { kind: "orderActive", order: action, isPaper: record.isPaper },
    assets: intentAssetInfos(chains, record, named),
  };
}

/**
 * What a confirmed intent with nothing to send took effect as, once it reconciled (spec 4, section
 * 3.5): an unfreeze, with the agents its card named (decision 0128), and an auto order's card,
 * with the order it made active or why the order did not start (decision 0189), in paper mode or
 * live. `undefined` for any other kind, before `reconciled`, and for an auto order whose agent is
 * no longer stored.
 */
export async function writtenReceiptOf(
  source: WrittenReceiptSource,
  call: Call,
): Promise<WrittenReceipt | undefined> {
  const { record } = source;
  if (record.state !== "reconciled" || record.quote === undefined) {
    return undefined;
  }
  if (record.kind === "unfreeze") {
    const action = unfreezeActionOf(unfreezeQuoteDocument.decode(record.quote));
    return { outcome: { ...action, kind: "unfrozen" }, assets: noAssets };
  }
  return record.kind === "autoOrder"
    ? orderOutcomeOf(source, autoOrderQuoteDocument.decode(record.quote), call)
    : undefined;
}
