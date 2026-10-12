import type { CapGate } from "../confirmations/cap-gate.js";
import type { Confirmations } from "../confirmations/create-confirmations.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { Holdings } from "../money-path/wallet-facts.js";
import type { OrderParts } from "../orders/create-order.js";
import { createOrderFills, type OrderFills } from "../orders/fill-orders.js";
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
  const { stores, chains, clock, ids, publish, isLocked, custody, canPrice } = options;
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
    canPrice,
  };
}

/** The execute step of an auto order's card: its order follows the answer (decision 0189). */
export function followCardOf(
  parts: OrderParts,
): (snapshot: IntentSnapshot, call: { readonly signal: AbortSignal }) => Promise<IntentSnapshot> {
  return async (snapshot, call) =>
    (await followOrderCard(parts, snapshot.record.id, call.signal)) ?? snapshot;
}

/**
 * The auto order fills (decision 0195), on the engine's money path and its rolling cap gate. Live
 * fills stay off unless the engine's options turn them on.
 */
export function orderFillsOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly moneyPath: MoneyPath;
    readonly gate: CapGate;
    readonly holdings: Holdings;
  },
): OrderFills {
  const { stores, custody, prices, chains, isLocked, clock, ids, publish } = options;
  return createOrderFills({
    ...parts,
    orders: stores.orders,
    agents: stores.agents,
    custody,
    prices,
    chains,
    isLocked,
    liveFills: options.liveOrderFills === true,
    clock,
    ids,
    publish,
  });
}
