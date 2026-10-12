import type { Confirmations } from "../confirmations/create-confirmations.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { OrderParts } from "../orders/create-order.js";
import { followOrderCard } from "../orders/follow-order-card.js";
import type { EngineOptions } from "./create-engine.js";

/** What the auto order use cases read and write through, from the engine's options. */
export function orderPartsOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly confirmations: Confirmations;
    readonly wallets: OrderParts["wallets"];
  },
): OrderParts {
  const { stores, chains, clock, ids, publish, isLocked, custody } = options;
  const { orders, agents } = stores;
  const { stored, confirmations, wallets } = parts;
  const expireCard: OrderParts["expireCard"] = async (intent, call) => {
    await confirmations.expire(intent, call);
  };
  return {
    orders,
    stored,
    agents,
    wallets,
    custody,
    chains,
    clock,
    ids,
    publish,
    isLocked,
    expireCard,
  };
}

/** The execute step of an auto order's card: its order follows the answer (decision 0189). */
export function followCardOf(
  parts: OrderParts,
): (snapshot: IntentSnapshot, call: { readonly signal: AbortSignal }) => Promise<IntentSnapshot> {
  return async (snapshot, call) =>
    (await followOrderCard(parts, snapshot.record.id, call.signal)) ?? snapshot;
}
