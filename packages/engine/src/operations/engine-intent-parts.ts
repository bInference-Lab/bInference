import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import {
  type ConfigChangeHandlers,
  createConfigChangeHandlers,
} from "../config-changes/config-change-handlers.js";
import { writeConfigChange } from "../config-changes/write-config-change.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import { createStoredIntents, type StoredIntents } from "../intents/create-stored-intents.js";
import { createExecuteConfirmed, type ExecuteConfirmed } from "../money-path/execute-confirmed.js";
import type { LaunchRouting } from "../money-path/launch-routing.js";
import type { VenueQuoteSourceOptions } from "../money-path/venue-quote-source.js";
import type { OrderParts } from "../orders/create-order.js";
import { createPaperFills } from "../paper/paper-fills.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { writeUnfreeze } from "../safety/write-unfreeze.js";
import { fillStakeOnPaper } from "../staking/fill-stake-on-paper.js";
import { createRuleFillEnd } from "../webhooks/rule-fill-end.js";
import { createRuleFillOnPaper } from "../webhooks/rule-fill-on-paper.js";
import type { WebhookRuleParts } from "../webhooks/webhook-rule-parts.js";
import type { EngineOptions } from "./create-engine.js";
import { fillEndOf, fillOnPaperOf, followCardOf, followRuleCardOf } from "./engine-orders.js";
import { installQuotasOf } from "./engine-quotas.js";

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

// A confirmed config change is applied to the config file; with none handed, it waits.
function configChangeWriteOf(options: EngineOptions, stored: StoredIntents): ExecuteConfirmed {
  const { configChanges, stores, clock } = options;
  return async (snapshot, call) =>
    configChanges === undefined
      ? snapshot
      : writeConfigChange(
          { stored, intents: stores.intents, configChanges, clock },
          snapshot,
          call.signal,
        );
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
    readonly rules: WebhookRuleParts;
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
    configChange: configChangeWriteOf(options, stored),
    autoOrder: followCardOf(parts.orders),
    webhookRule: followRuleCardOf(parts.rules),
    orderFill: fillOnPaperOf(options, { paper: fills, stored, portfolio }),
    ruleFill: createRuleFillOnPaper({
      paper: fills,
      stored,
      rules: stores.webhookRules,
      clock,
      publish,
    }),
    paperStake: async (snapshot, call) =>
      fillStakeOnPaper(
        {
          stored,
          positions,
          portfolio,
          prices,
          clock,
          unbondings: stores.unbondings,
          booked: options.positions,
        },
        snapshot,
        call,
      ),
  });
}

/**
 * The one writer of intents, which tells the chat relay of each settle message it stores, and
 * writes the skip of an order's fill, or of a live rule fill, with the move that ends its intent
 * (decisions 0197 and 0342).
 */
export function storedIntentsOf(
  options: EngineOptions,
  parts: { readonly settled: (message: AgentInboxMessage) => void; readonly gate: CapGate },
): StoredIntents {
  const { stores, ids, random, publish } = options;
  const { intents, agents } = stores;
  const fillEnd = fillEndOf(options, parts.gate);
  const spent: CapGate["spent"] = async (snapshot, call) => parts.gate.spent(snapshot, call);
  const ruleFillEnd = createRuleFillEnd({ rules: stores.webhookRules, spent });
  const { settled } = parts;
  return createStoredIntents({
    intents,
    agents,
    ids,
    random,
    publish,
    settled,
    fillEnd,
    ruleFillEnd,
  });
}

/**
 * What sends a live trade on a launch's own contracts to the agent's launch wallet (decision 0217).
 */
export function launchRoutingOf(options: EngineOptions, paper: PaperParts): LaunchRouting {
  const { stores, host, custody, chains } = options;
  return { install: stores.install, host, custody, holdings: paper.holdings, chains };
}

/** The config change handlers (decision 0393), when the composition root hands the config file. */
export function configChangeHandlersOf(
  options: EngineOptions,
  stored: StoredIntents,
): Partial<ConfigChangeHandlers> {
  const { configChanges, stores, wallets, isLocked, chains, clock, ids } = options;
  if (configChanges === undefined) {
    return {};
  }
  const { intents, agents } = stores;
  return createConfigChangeHandlers({
    quotas: installQuotasOf(options),
    stored,
    intents,
    agents,
    wallets,
    configChanges,
    isLocked,
    chains,
    clock,
    ids,
  });
}
