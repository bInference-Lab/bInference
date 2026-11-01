import type { ChainRegistry } from "@binference/chain";
import type { BridgeStore } from "../bridges/ports.js";
import { receiptAfterLine } from "../confirmations/card-closing.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { InstallStore, TransactionStore } from "../ports.js";
import { bridgeReceiptOf } from "../surfaces/bridge-receipt.js";
import { deliveryOf } from "./delivery-view-of.js";
import type { ViewReads } from "./intent-view-of.js";

/** What a bridge's view reads beyond the intent: its delivery, transactions and the wallets. */
export interface BridgeViewOptions {
  readonly chains: ChainRegistry;
  /** Each bridge's delivery, which a bridge's view shows once its deposit is final. */
  readonly bridges?: Pick<BridgeStore, "get">;
  /** Each intent's transactions, whose last one a bridge on its way links to. */
  readonly transactions: Pick<TransactionStore, "ofIntent">;
  /** The install's wallets, whose label a bridge's refund names. */
  readonly install: Pick<InstallStore, "read">;
}

/**
 * What a bridge's view shows beyond its stored intent (protocol spec, section 8.3): its delivery
 * once its deposit is final, and the line its card ends with then, as every surface shows it.
 * Nothing for any other intent, and no line for a paper bridge.
 */
export async function bridgeViewReads(
  options: BridgeViewOptions,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<Pick<ViewReads, "delivery" | "bridgeReceipt">> {
  if (record.kind !== "bridge") {
    return {};
  }
  const delivery = await deliveryOf(options.bridges, record, signal);
  const receipt = record.isPaper
    ? undefined
    : await bridgeReceiptOf({ ...options, record }, { signal });
  return {
    delivery,
    bridgeReceipt: receipt === undefined ? undefined : receiptAfterLine(receipt.outcome),
  };
}
