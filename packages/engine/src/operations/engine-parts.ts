import { createDailyModelBudget } from "../billing/daily-model-budget.js";
import { createModelBudget, type ModelBudget } from "../billing/model-budget.js";
import { createUsageHandlers, type UsageHandlers } from "../billing/usage-handlers.js";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import { type ChatHandlers, type ChatRelay, createChatRelay } from "../chat/chat-relay.js";
import { createRunningTurns } from "../chat/running-turns.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { ModelBilling } from "../ports.js";
import { createSafetyHandlers, type SafetyHandlers } from "../safety/safety-handlers.js";
import { createScheduleQueue, type ScheduleQueue } from "../schedules/run-schedules.js";
import { createScheduleHandlers, type ScheduleHandlers } from "../schedules/schedule-handlers.js";
import { ownerImagesOf } from "../uploads/owner-images.js";
import { createUploadHandlers, type UploadHandlers } from "../uploads/upload-handlers.js";
import { createUploadShelf } from "../uploads/upload-shelf.js";
import type { EngineOptions } from "./create-engine.js";
import { intentViewOf } from "./intent-view-of.js";

/**
 * The chat operations the engine answers itself, `usage/get`, `upload/start` and the schedule
 * operations.
 */
export interface EngineChatHandlers
  extends ChatHandlers, UsageHandlers, UploadHandlers, ScheduleHandlers {}

/**
 * The engine's chat relay, whose settle pushes carry each intent's view as `intent/get` gives it,
 * read through the stored intents once `attach` gives them, and its handlers with `usage/get`.
 */
export interface EngineChat {
  readonly relay: ChatRelay;
  /** The schedule queue, whose wake-ups ask the chat's model budget and push as chat does. */
  readonly schedules: ScheduleQueue;
  readonly handlers: EngineChatHandlers;
  /** Hears each settle message the stored intents wrote, and each schedule's wake-up. */
  readonly settled: (message: AgentInboxMessage) => void;
  readonly attach: (stored: StoredIntents) => void;
}

// The owner's uploads, and every image the runtime reads: the uploads and the bot's photos.
function imagesOf(options: EngineOptions) {
  const uploads =
    options.uploads ?? createUploadShelf({ clock: options.clock, random: options.random });
  const bot = options.botImages === undefined ? {} : { bot: options.botImages };
  return { uploads, images: ownerImagesOf({ uploads, ...bot }) };
}

// Each agent's daily model budget over the billing, which chat turns and the schedule queue ask.
function budgetOf(options: EngineOptions, billing: ModelBilling): ModelBudget {
  const { stores, clock, publish, ownerTimeZone: timeZone } = options;
  return createModelBudget({ billing, usage: stores.modelUsage, timeZone, clock, publish });
}

/** Creates the engine's {@link EngineChat}, whose turns spend each agent's model budget. */
export function engineChatOf(options: EngineOptions): EngineChat {
  const { stores, chains, clock } = options;
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
  const { uploads, images } = imagesOf(options);
  const budget = budgetOf(options, billing);
  const relay = createChatRelay({
    agentInbox: stores.agentInbox,
    questions: stores.questions,
    agents: stores.agents,
    turns: options.turns ?? createRunningTurns(),
    budget,
    intentView: async (intent, signal) => {
      const snapshot = await late.stored?.snapshot(intent, { signal });
      return snapshot === undefined ? undefined : intentViewOf(snapshot, chains);
    },
    ids: options.ids,
    random: options.random,
    clock: options.clock,
    publish: options.publish,
    images,
  });
  const settled = (message: AgentInboxMessage): void => {
    relay.settled(message);
  };
  const schedules = schedulesOf(options, { budget, settled });
  return {
    relay,
    schedules: schedules.queue,
    handlers: {
      ...relay.handlers,
      ...usageHandlersOf(options, billing),
      ...createUploadHandlers(uploads),
      ...schedules.handlers,
    },
    settled,
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

// The schedule operations, journaled and announced as settings changes are, and the schedule
// queue, whose wake-ups ask the chat's model budget and reach the runtime as the chat's pushes do.
function schedulesOf(
  options: EngineOptions,
  chat: { readonly budget: ModelBudget; readonly settled: (message: AgentInboxMessage) => void },
): { readonly handlers: ScheduleHandlers; readonly queue: ScheduleQueue } {
  const { stores, ids, clock, publish, ownerTimeZone } = options;
  const { schedules, agents } = stores;
  return {
    handlers: createScheduleHandlers({
      schedules,
      agents,
      journal: stores.configJournal,
      ownerTimeZone,
      ids,
      clock,
      publish,
    }),
    queue: createScheduleQueue({
      schedules,
      agents,
      budget: chat.budget,
      ownerTimeZone,
      woke: chat.settled,
      ids,
      clock,
    }),
  };
}
