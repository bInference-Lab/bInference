import { createDailyModelBudget } from "../billing/daily-model-budget.js";
import { createModelBudget } from "../billing/model-budget.js";
import { createUsageHandlers, type UsageHandlers } from "../billing/usage-handlers.js";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { type ChatHandlers, type ChatRelay, createChatRelay } from "../chat/chat-relay.js";
import { createRunningTurns } from "../chat/running-turns.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { ModelBilling } from "../ports.js";
import { createSafetyHandlers, type SafetyHandlers } from "../safety/safety-handlers.js";
import type { EngineOptions } from "./create-engine.js";
import { intentViewOf } from "./intent-view-of.js";

/** The chat operations the engine answers itself, and `usage/get`. */
export interface EngineChatHandlers extends ChatHandlers, UsageHandlers {}

/**
 * The engine's chat relay, whose settle pushes carry each intent's view as `intent/get` gives it,
 * read through the stored intents once `attach` gives them, and its handlers with `usage/get`.
 */
export interface EngineChat {
  readonly relay: ChatRelay;
  readonly handlers: EngineChatHandlers;
  /** Hears each settle message the stored intents wrote. */
  readonly settled: (message: AgentInboxMessage) => void;
  readonly attach: (stored: StoredIntents) => void;
}

/** Creates the engine's {@link EngineChat}, whose turns spend each agent's model budget. */
export function engineChatOf(options: EngineOptions): EngineChat {
  const { stores, chains, clock, publish } = options;
  // Who pays for model calls: the billing the options give, else the daily model budget over the
  // stored usage, which reads each agent's limits as they are in effect now.
  const billing =
    options.billing ??
    createDailyModelBudget({
      usage: stores.modelUsage,
      agents: stores.agents,
      timeZone: options.ownerTimeZone,
      clock,
    });
  const late: { stored?: StoredIntents } = {};
  const relay = createChatRelay({
    agentInbox: stores.agentInbox,
    questions: stores.questions,
    agents: stores.agents,
    turns: options.turns ?? createRunningTurns(),
    budget: createModelBudget({
      billing,
      usage: stores.modelUsage,
      timeZone: options.ownerTimeZone,
      clock,
      publish,
    }),
    intentView: async (intent, signal) => {
      const snapshot = await late.stored?.snapshot(intent, { signal });
      return snapshot === undefined ? undefined : intentViewOf(snapshot, chains);
    },
    ids: options.ids,
    random: options.random,
    clock: options.clock,
    publish: options.publish,
    ...(options.ownerImages === undefined ? {} : { images: options.ownerImages }),
  });
  return {
    relay,
    handlers: { ...relay.handlers, ...usageHandlersOf(options, billing) },
    settled: (message) => {
      relay.settled(message);
    },
    attach: (stored) => {
      late.stored = stored;
    },
  };
}

// `usage/get`, over the engine's billing and stored usage in the owner's days.
function usageHandlersOf(options: EngineOptions, billing: ModelBilling): UsageHandlers {
  const { stores, ownerTimeZone } = options;
  const usage = stores.modelUsage;
  return createUsageHandlers({ billing, usage, agents: stores.agents, timeZone: ownerTimeZone });
}

/**
 * The freeze, which also stops the turns it froze, the safety status and the rescue, which reads
 * every wallet's live balances, never paper ones (decision 0100).
 */
export function safetyHandlersOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly relay: ChatRelay },
): SafetyHandlers {
  const { stores, clock } = options;
  const { agents, intents, install, orders } = stores;
  const { stored, relay } = parts;
  const handlers = createSafetyHandlers({
    ...options,
    stored,
    intents,
    agents,
    install,
    orders,
    simulator: options.chainSimulator,
    policy: createPolicyCheck({ prices: options.prices, clock }),
  });
  return { ...handlers, "safety/freeze": relay.freezing(handlers["safety/freeze"]) };
}
