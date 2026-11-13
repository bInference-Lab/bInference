import { type AlertHandlers, createAlertHandlers } from "../alerts/alert-handlers.js";
import { type AlertFiring, createAlertFiring } from "../alerts/fire-alerts.js";
import { createDailyModelBudget } from "../billing/daily-model-budget.js";
import { createModelBudget, type ModelBudget } from "../billing/model-budget.js";
import { createUsageHandlers, type UsageHandlers } from "../billing/usage-handlers.js";
import type { AgentInboxMessage } from "../chat/agent-inbox-record.js";
import type { ChatRelayOptions, ChatWakes } from "../chat/chat-relay-parts.js";
import { type ChatHandlers, type ChatRelay, createChatRelay } from "../chat/chat-relay.js";
import { heldInboxOf } from "../chat/inbox-hold.js";
import { createRunningTurns } from "../chat/running-turns.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createLaunchHandlers, type LaunchHandlers } from "../launches/launch-handlers.js";
import { createLaunchpadHandlers, type LaunchpadHandlers } from "../launches/launchpad-handlers.js";
import { type ActivityHandlers, createActivityHandlers } from "../leaders/activity-handlers.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { ModelBilling } from "../ports.js";
import { createSafetyHandlers, type SafetyHandlers } from "../safety/safety-handlers.js";
import { createScheduleQueue, type ScheduleQueue } from "../schedules/run-schedules.js";
import { createScheduleHandlers, type ScheduleHandlers } from "../schedules/schedule-handlers.js";
import {
  createShellPart,
  machineHandlersOf,
  type ShellPart,
  type ShellPartHandlers,
} from "../shell/engine-shell.js";
import { ownerImagesOf } from "../uploads/owner-images.js";
import { createUploadHandlers, type UploadHandlers } from "../uploads/upload-handlers.js";
import { createUploadShelf } from "../uploads/upload-shelf.js";
import type { EngineOptions } from "./create-engine.js";
import { launchRoutingOf } from "./engine-intent-parts.js";
import { intentViewOf } from "./intent-view-of.js";
import { createTokenReadHandlers, type TokenReadHandlers } from "./token-read-handlers.js";

/**
 * The chat operations the engine answers itself, `usage/get`, `upload/start`, the schedule and
 * alert operations, whose wake-ups reach the agent through the chat, `wallet/activity`, which
 * reads the wallets the alerts and copy orders track, `launch/list`, which reads the launch
 * feed's records, and `launchpad/list`, which reads the launchpads the engine runs.
 */
export interface EngineChatHandlers
  extends
    ChatHandlers,
    UsageHandlers,
    UploadHandlers,
    ScheduleHandlers,
    AlertHandlers,
    ActivityHandlers,
    LaunchHandlers,
    LaunchpadHandlers,
    ShellPartHandlers {}

/**
 * The engine's chat relay, whose settle pushes carry each intent's view as `intent/get` gives it,
 * read through the stored intents once `attach` gives them, and its handlers with `usage/get`.
 */
export interface EngineChat {
  readonly relay: ChatRelay;
  /** The schedule queue, whose wake-ups ask the chat's model budget and push as chat does. */
  readonly schedules: ScheduleQueue;
  /** The alert firing, whose wake-ups ask the chat's model budget and push as chat does. */
  readonly alerts: AlertFiring;
  readonly handlers: EngineChatHandlers;
  /** Hears each settle message the stored intents wrote, and each schedule's or alert's wake-up. */
  readonly settled: (message: AgentInboxMessage) => void;
  readonly attach: (stored: StoredIntents) => void;
  /** The agent's shell, whose commands the owner's stop and a freeze stop (decision 0409). */
  readonly shell: ShellPart;
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

// Who pays for model calls: the billing the options give, else the daily model budget over the
// stored usage, which reads each agent's limits as they are in effect now; and each agent's daily
// model budget over it.
function budgetsOf(options: EngineOptions): {
  readonly billing: ModelBilling;
  readonly budget: ModelBudget;
} {
  const { stores, clock } = options;
  const billing =
    options.billing ??
    createDailyModelBudget({
      usage: stores.modelUsage,
      agents: stores.agents,
      timeZone: options.ownerTimeZone,
      clock,
    });
  return { billing, budget: budgetOf(options, billing) };
}

// The parts of the agent's chat its shell gives: its senses of the machine, and the rest.
type MachineSense = "localVoice" | "screen" | "requests";
type ShellSide = "madeImageFiles" | "sentFiles" | "browser" | "pdfReader" | MachineSense;

// The machine's own voice, the owner's screen and the API calls, when the shell gives them.
function machineSenseOf(shell: EngineOptions["shell"]): Pick<ChatRelayOptions, MachineSense> {
  const localVoice = shell?.voice;
  const screen = shell?.screen;
  return {
    ...(localVoice === undefined ? {} : { localVoice }),
    ...(screen === undefined ? {} : { screen }),
    ...(shell?.requests === undefined ? {} : { requests: shell.requests }),
  };
}

// What the agent's shell gives its chat on this machine: its browser, its PDF reader, the
// machine's voice, the owner's screen, and the files made images and media are saved in and sent
// files read from.
function shellSideOf(shell: EngineOptions["shell"]): Pick<ChatRelayOptions, ShellSide> {
  const browser = shell?.browser;
  const pdfReader = shell?.pdfReader;
  return {
    ...(browser === undefined ? {} : { browser }),
    ...(pdfReader === undefined ? {} : { pdfReader }),
    ...machineSenseOf(shell),
    ...(shell?.files === undefined
      ? {}
      : { madeImageFiles: shell.files.files, sentFiles: shell.files }),
  };
}

type AgentSide = "viewImages" | "communityPluginsOn" | "listedMcpOn" | "runtimeChats" | ShellSide;

// What the agent's chat reaches beyond the engine, when the composition root gives it: the images
// it views, its shell's parts, whether a community plugin or a listed MCP server speaks in its
// turns, and the runtime's side of a chat deletion.
function agentSideOf(options: EngineOptions): Pick<ChatRelayOptions, AgentSide> {
  const { viewImages, shell, communityPluginsOn, listedMcpOn, runtimeChats } = options;
  return {
    ...(viewImages === undefined ? {} : { viewImages }),
    ...(runtimeChats === undefined ? {} : { runtimeChats }),
    ...shellSideOf(shell),
    ...(communityPluginsOn === undefined ? {} : { communityPluginsOn }),
    ...(listedMcpOn === undefined ? {} : { listedMcpOn }),
  };
}

// What the chat relay reads, writes and pushes through: settle pushes read each intent's view
// through the stored intents once they are attached.
function relayOptionsOf(
  options: EngineOptions,
  parts: {
    readonly budget: ModelBudget;
    readonly images: ReturnType<typeof imagesOf>["images"];
    readonly late: { readonly stored?: StoredIntents };
  },
): ChatRelayOptions {
  const { stores, chains } = options;
  const { budget, images, late } = parts;
  return {
    ...heldInboxOf(stores.agentInbox),
    questions: stores.questions,
    agents: stores.agents,
    turns: options.turns ?? createRunningTurns(),
    budget,
    intentView: async (intent, signal) => {
      const snapshot = await late.stored?.snapshot(intent, { signal });
      // A settled bridge's reason names its destination chain, as every surface's view does.
      const reads = { destinations: options.destinations };
      return snapshot === undefined ? undefined : intentViewOf(snapshot, chains, reads);
    },
    ids: options.ids,
    random: options.random,
    clock: options.clock,
    publish: options.publish,
    images,
    ...agentSideOf(options),
    credentials: stores.credentials,
  };
}

/** Creates the engine's {@link EngineChat}, whose turns spend each agent's model budget. */
export function engineChatOf(options: EngineOptions): EngineChat {
  const { stores } = options;
  const { billing, budget } = budgetsOf(options);
  const late: { stored?: StoredIntents } = {};
  const { uploads, images } = imagesOf(options);
  const relayOptions = relayOptionsOf(options, { budget, images, late });
  const shell = createShellPart({
    ...(options.shell === undefined ? {} : { shell: options.shell }),
    store: stores.shell,
    journal: stores.configJournal,
    wakeParts: relayOptions,
  });
  const relay = createChatRelay({
    ...relayOptions,
    onStop: (agent, by) => {
      shell.stop(agent, by);
    },
  });
  const settled = (message: AgentInboxMessage): void => {
    relay.settled(message);
  };
  const wakes = { budget, settled, inboxHold: relayOptions.inboxHold };
  const schedules = schedulesOf(options, wakes);
  const alerts = alertFiringOf(options, wakes);
  return {
    relay,
    schedules: schedules.queue,
    alerts,
    handlers: {
      ...relay.handlers,
      ...usageHandlersOf(options, billing),
      ...createUploadHandlers(uploads),
      ...schedules.handlers,
      ...alertHandlersOf(options),
      ...watchedHandlersOf(options),
      ...shell.handlers,
    },
    settled,
    shell,
    attach: (stored) => {
      late.stored = stored;
    },
  };
}

// `wallet/activity` and `launch/list`, over what the leader watcher and the launch feed stored,
// and `launchpad/list`, over the launchpads the launch host runs.
function watchedHandlersOf(
  options: EngineOptions,
): ActivityHandlers & LaunchHandlers & LaunchpadHandlers {
  const { stores, chains, host, launchHost } = options;
  return {
    ...createActivityHandlers({
      trackedWallets: stores.trackedWallets,
      alerts: stores.alerts,
      orders: stores.orders,
      agents: stores.agents,
      chains,
    }),
    ...createLaunchHandlers({
      launches: stores.launches,
      chains,
      isLaunchpad: (venue) => host.isLaunchpad(venue),
    }),
    ...createLaunchpadHandlers({ chains, ...(launchHost === undefined ? {} : { launchHost }) }),
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
  chat: ChatWakes,
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
      inboxHold: chat.inboxHold,
      ids,
      clock,
    }),
  };
}

// The alert operations, over the alert store, with the launchpads the venue host runs.
function alertHandlersOf(options: EngineOptions): AlertHandlers {
  const { stores, chains, ids, clock, host } = options;
  return createAlertHandlers({
    alerts: stores.alerts,
    agents: stores.agents,
    chains,
    isLaunchpad: (venue) => host.isLaunchpad(venue),
    canPrice: options.canPrice,
    ids,
    clock,
  });
}

// The alert firing, whose wake-ups ask the chat's model budget, wait out a chat deletion and
// reach the runtime as the chat's pushes do.
function alertFiringOf(options: EngineOptions, chat: ChatWakes): AlertFiring {
  const { stores, chains, ids, clock, publish } = options;
  return createAlertFiring({
    alerts: stores.alerts,
    agents: stores.agents,
    budget: chat.budget,
    chains,
    intents: stores.intents,
    woke: chat.settled,
    inboxHold: chat.inboxHold,
    ids,
    clock,
    publish,
  });
}

// The token reads, `asset/get`, `quote/get` and `risk/check`, on the money path's own parts.
function tokenReadsOf(options: EngineOptions, paper: PaperParts): TokenReadHandlers {
  const { stores, custody, host, chains, clock, readTokenFacts } = options;
  const { wallets, holdings } = paper;
  const launches = launchRoutingOf(options, paper);
  const quotes = { custody, wallets, holdings, launches, host, chains, clock };
  const { risk } = options;
  return createTokenReadHandlers({ agents: stores.agents, chains, readTokenFacts, quotes, risk });
}

/**
 * The engine's lookups that move nothing: a token's info and a quote, the agent's shell commands
 * and the chain's names.
 */
export function lookupHandlersOf(
  options: EngineOptions,
  paper: PaperParts,
): TokenReadHandlers & ReturnType<typeof machineHandlersOf> {
  return { ...machineHandlersOf(options), ...tokenReadsOf(options, paper) };
}
