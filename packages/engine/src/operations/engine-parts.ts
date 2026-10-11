import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { type ChatRelay, createChatRelay } from "../chat/chat-relay.js";
import { createRunningTurns } from "../chat/running-turns.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import { createSafetyHandlers, type SafetyHandlers } from "../safety/safety-handlers.js";
import type { EngineOptions } from "./create-engine.js";
import { intentViewOf } from "./intent-view-of.js";

/**
 * The engine's chat relay, whose settle pushes carry each intent's view as `intent/get` gives it,
 * read through the stored intents once `attach` gives them.
 */
export interface EngineChat {
  readonly relay: ChatRelay;
  /** Hears each settle message the stored intents wrote. */
  readonly settled: (message: AgentInboxMessage) => void;
  readonly attach: (stored: StoredIntents) => void;
}

/** Creates the engine's {@link EngineChat}. */
export function engineChatOf(options: EngineOptions): EngineChat {
  const { stores, chains } = options;
  const late: { stored?: StoredIntents } = {};
  const relay = createChatRelay({
    agentInbox: stores.agentInbox,
    agents: stores.agents,
    turns: options.turns ?? createRunningTurns(),
    intentView: async (intent, signal) => {
      const snapshot = await late.stored?.snapshot(intent, { signal });
      return snapshot === undefined ? undefined : intentViewOf(snapshot, chains);
    },
    ids: options.ids,
    clock: options.clock,
    publish: options.publish,
  });
  return {
    relay,
    settled: (message) => {
      relay.settled(message);
    },
    attach: (stored) => {
      late.stored = stored;
    },
  };
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
  const { agents, intents, install } = stores;
  const { stored, relay } = parts;
  const handlers = createSafetyHandlers({
    ...options,
    stored,
    intents,
    agents,
    install,
    simulator: options.chainSimulator,
    policy: createPolicyCheck({ prices: options.prices, clock }),
  });
  return { ...handlers, "safety/freeze": relay.freezing(handlers["safety/freeze"]) };
}
