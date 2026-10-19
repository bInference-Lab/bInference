import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import { createStoredIntents, type StoredIntents } from "../intents/create-stored-intents.js";
import { createExecuteConfirmed, type ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { LaunchRouting } from "../money-path/launch-routing.js";
import type { VenueQuoteSourceOptions } from "../money-path/venue-quote-source.js";
import type { OrderParts } from "../orders/create-order.js";
import { createPaperFills } from "../paper/paper-fills.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { writeUnfreeze } from "../safety/write-unfreeze.js";
import type { EngineOptions } from "./create-engine.js";
import { fillEndOf, fillOnPaperOf, followCardOf } from "./engine-orders.js";

/**
 * A re-quote at a tap weighs every venue as the money path does, on the paper balances.
 */
export function requoteOptions(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): VenueQuoteSourceOptions {
  const { custody, host, chains, clock, prices, stores } = options;
  const { stored, paper } = parts;
  const { wallets, simulator, holdings } = paper;
  const { install } = stores;
  return { stored, custody, wallets, holdings, host, simulator, prices, chains, clock, install };
}

/**
 * A confirmed paper intent fills in the paper portfolio, an unfreeze is written, and any other live
 * one goes to the executor.
 */
export function executeOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly paper: PaperParts;
    readonly orders: OrderParts;
  },
): ExecuteConfirmed {
  const {
    stored,
    paper: { positions, portfolio },
  } = parts;
  const { prices, clock, executor, publish, ids, stores } = options;
  const fills = createPaperFills({ stored, positions, portfolio, prices, clock });
  const { agents, intents, orders } = stores;
  const written = { stored, agents, intents, orders, clock, ids, publish };
  return createExecuteConfirmed({
    paper: fills,
    executor,
    publish,
    unfreeze: async (snapshot, call) => writeUnfreeze(written, snapshot, call.signal),
    autoOrder: followCardOf(parts.orders),
    orderFill: fillOnPaperOf(options, { paper: fills, stored, portfolio }),
  });
}

/**
 * The one writer of intents, which tells the chat relay of each settle message it stores, and
 * writes the skip of an order's fill with the move that ends its intent (decision 0197).
 */
export function storedIntentsOf(
  options: EngineOptions,
  parts: { readonly settled: (message: AgentInboxMessage) => void; readonly gate: CapGate },
): StoredIntents {
  const { stores, ids, random, publish } = options;
  const { intents, agents } = stores;
  const fillEnd = fillEndOf(options, parts.gate);
  const { settled } = parts;
  return createStoredIntents({ intents, agents, ids, random, publish, settled, fillEnd });
}

/**
 * What sends a live trade on a launch's own contracts to the agent's launch wallet (decision 0217).
 */
export function launchRoutingOf(options: EngineOptions, paper: PaperParts): LaunchRouting {
  const { stores, host, custody, chains } = options;
  return { install: stores.install, host, custody, holdings: paper.holdings, chains };
}
