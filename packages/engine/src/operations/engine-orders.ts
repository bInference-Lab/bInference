import type { CapGate } from "../confirmations/cap-gate.js";
import type { CardTimerParts } from "../confirmations/card-timer.js";
import type { Confirmations } from "../confirmations/create-confirmations.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { Holdings } from "../money-path/wallet-facts.js";
import type { OrderParts } from "../orders/create-order.js";
import { createFillEnd, type FillEnd } from "../orders/fill-ends.js";
import { createFillOnPaper, type FillOnPaperParts } from "../orders/fill-on-paper.js";
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
  const { stores, chains, clock, ids, publish, isLocked, custody, canPrice, readTokenFacts } =
    options;
  const { orders, agents } = stores;
  const { stored, confirmations, wallets } = parts;
  const expireCard: OrderParts["expireCard"] = async (intent, call) => {
    await confirmations.expire(intent, call);
  };
  return {
    orders,
    stored,
    intents: stores.intents,
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
    readTokenFacts,
    liveFills: options.liveOrderFills === true,
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
  const { stores, custody, prices, chains, isLocked, clock, ids, publish, positions } = options;
  return createOrderFills({
    ...parts,
    positions,
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

/** The execute step of an order's paper fill, which writes the fill on its order (decision 0195). */
export function fillOnPaperOf(
  options: EngineOptions,
  parts: Pick<FillOnPaperParts, "paper" | "stored" | "portfolio">,
): ExecuteConfirmed {
  const { stores, chains, clock, ids } = options;
  return createFillOnPaper({ ...parts, orders: stores.orders, chains, clock, ids });
}

/**
 * The skip of an order's fill that the one writer of intents adds to the move ending its intent
 * (decision 0197), with the rolling cap's use a skip for the cap reports.
 */
export function fillEndOf(options: EngineOptions, gate: CapGate): FillEnd {
  const { stores, ids } = options;
  const spent: CapGate["spent"] = async (snapshot, call) => gate.spent(snapshot, call);
  return createFillEnd({ orders: stores.orders, spent, ids });
}

/**
 * What the card timer closes cards through: an intent's card through the confirmations, and an
 * auto order's card through its order, which moves with it.
 */
export function cardTimerOf(
  options: EngineOptions,
  parts: { readonly confirmations: Confirmations; readonly orders: OrderParts },
): CardTimerParts {
  const { confirmations, orders } = parts;
  return {
    intents: options.stores.intents,
    now: () => options.clock.now(),
    expire: async (intent, { signal }) => {
      await (intent.kind === "autoOrder"
        ? followOrderCard(orders, intent.id, signal)
        : confirmations.expire(intent.id, { signal }));
    },
  };
}
