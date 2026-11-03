import { ok, type Result } from "@binference/core";
import type { IntentChange } from "../intents/intent-change.js";
import type { OrderRecord } from "../orders/order-record.js";
import { constraintFault } from "./memory-call.js";
import type { MemoryOrderStore } from "./memory-order-store.js";
import type { MemoryWebhookRuleStore } from "./memory-webhook-rule-store.js";

/** The stores beside an in-memory intent store that a fill's move writes into. */
export interface MemoryFillStores {
  readonly orders?: MemoryOrderStore;
  readonly webhookRules?: MemoryWebhookRuleStore;
}

/** The order store beside the intent store, which a write that moves orders needs. */
export function ordersOf(stores: MemoryFillStores): MemoryOrderStore {
  if (stores.orders === undefined) {
    throw constraintFault("a write moves orders this store holds none of");
  }
  return stores.orders;
}

function rulesOf(stores: MemoryFillStores): MemoryWebhookRuleStore {
  if (stores.webhookRules === undefined) {
    throw constraintFault("a write fills a webhook rule this store holds none of");
  }
  return stores.webhookRules;
}

/**
 * Checks a move's fill writes before anything is written: an order fill's order moves, which it
 * answers, and a webhook rule fill's alert and rule. Either one that another write beat is
 * `stale`.
 */
export function checkFillWrites(
  stores: MemoryFillStores,
  change: IntentChange,
): Result<{ readonly orders?: readonly OrderRecord[] }, "stale"> {
  const alert =
    change.alert === undefined ? ok(undefined) : rulesOf(stores).checkFillNow(change.alert);
  if (!alert.ok || change.order === undefined) {
    return alert.ok ? ok({}) : alert;
  }
  const fill = ordersOf(stores).checkWriteNow(change.order);
  return fill.ok ? ok({ orders: fill.value }) : fill;
}

/** Writes a checked move's fill writes, as the move itself lands. */
export function saveFillWrites(
  stores: MemoryFillStores,
  change: IntentChange,
  orders: readonly OrderRecord[] | undefined,
): void {
  if (change.order !== undefined && orders !== undefined) {
    stores.orders?.saveNow(orders);
    stores.orders?.saveFillNow(change.order.fill);
  }
  if (change.alert !== undefined) {
    rulesOf(stores).saveFillNow(change.alert);
  }
}
