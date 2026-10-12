import type { Clock, Id } from "@binference/core";
import type { TurnSetup } from "../chats/chat-context.js";
import { type ChatRunner, createChatRunner } from "../chats/chat-runner.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import type { ContextSource, EngineChat } from "../relay/ports.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import { type RepairedTurn, repairUnfinishedTurns } from "../sessions/repair-turns.js";
import type { AgentDatabase } from "./agent-database.js";

/** The runtime's chat before it connects: its stores under the fence it raised, and repaired turns. */
export interface PreparedChat {
  readonly stores: AgentStores;
  readonly repaired: readonly RepairedTurn[];
}

/**
 * Takes the writer fence and repairs every turn a crash left unfinished (runtime spec, section
 * 2.1), before the runtime connects to the engine.
 */
export async function prepareChat(
  database: AgentDatabase,
  context: { readonly clock: Clock; readonly signal: AbortSignal },
): Promise<PreparedChat> {
  const fence = await database.fence.raise({ signal: context.signal });
  const { sessions, transcript, queue } = database;
  const stores = { sessions, transcript, queue, fence };
  return { stores, repaired: await repairUnfinishedTurns(stores, context) };
}

/** What the runtime's chat runs with once it is connected. */
export interface ChatStart {
  readonly prepared: PreparedChat;
  readonly engine: EngineChat;
  /** The workspace files and live facts each turn's context reads. */
  readonly turnContext: ContextSource;
  /** The settings in force: a reload applies from the next turn and merge point. */
  readonly settings: () => RuntimeSettings;
  readonly setup: (agent: Id<"agt">, settings: RuntimeSettings) => TurnSetup;
  readonly clock: Clock;
  readonly lifetime: AbortSignal;
}

/** The runtime's running chat: its runner, and the call that stops watching the inbox. */
export interface RuntimeChat {
  readonly runner: ChatRunner;
  readonly unwatch: () => void;
}

// A repaired turn's status line and its end (decision 0174), best effort: the engine cleared the
// runtime's running turns when it exited, so a failure here leaves nothing running.
async function endRepaired(start: ChatStart, signal: AbortSignal): Promise<void> {
  for (const { agent, turn, proposalUnknown } of start.prepared.repaired) {
    const statusKey = proposalUnknown ? "turn.failed.proposalUnknown" : "turn.failed.engine";
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each turn's line, then its end
      await start.engine.turnStatus({ agent, turn, statusKey }, signal);
      // oxlint-disable-next-line eslint/no-await-in-loop -- each turn's line, then its end
      await start.engine.endTurn({ agent, turn, outcome: "failed" }, signal);
    } catch {
      // The engine reads the turn as ended already; the next start does not repair it again.
    }
  }
}

async function listAll(engine: EngineChat, runner: ChatRunner, signal: AbortSignal): Promise<void> {
  for (let cursor: string | undefined; ;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the one before
    const page = await engine.listInbox(cursor, signal);
    // oxlint-disable-next-line eslint/no-await-in-loop -- messages are taken in their order
    await Promise.all(page.items.map(async (view) => runner.receive(view)));
    cursor = page.next;
    if (cursor === undefined) {
      return;
    }
  }
}

/**
 * Starts the runtime's chat once it is connected (runtime spec, section 2.1): the repaired turns'
 * ends go to the engine, the chat queue's waiting messages start their turns, every untaken
 * message is read with `inbox/list`, and the `inbox` topic is watched, read again after a gap.
 */
export async function startChat(start: ChatStart): Promise<RuntimeChat> {
  const { engine, lifetime } = start;
  await endRepaired(start, lifetime);
  const relist = (): void => void listAll(engine, runner, lifetime).catch(() => undefined);
  const runner = createChatRunner({
    stores: start.prepared.stores,
    engine,
    turnContext: start.turnContext,
    setup: (agent) => start.setup(agent, start.settings()),
    mode: () => start.settings().chats.newMessageMode,
    clock: start.clock,
    lifetime,
    onRoom: relist,
  });
  await runner.resume();
  await listAll(engine, runner, lifetime);
  const unwatch = engine.watchInbox({
    onMessage: (view) => void runner.receive(view).catch(() => undefined),
    refetch: async (signal) => listAll(engine, runner, signal),
  });
  return { runner, unwatch };
}
