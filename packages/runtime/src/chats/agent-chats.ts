import type { Id } from "@binference/core";
import type { ChatTurn } from "../loop/chat-turn.js";

/** A turn an agent runs, and the promise that settles once it ended and was handled. */
interface RunningTurn {
  readonly turn: ChatTurn;
  readonly done: Promise<void>;
}

/**
 * Each agent's chat, one field to a map: its open session, its running turn, a session a clear
 * closes once that turn ends, and when it may start its next turn.
 */
export interface AgentChats {
  /** The open session whose waiting messages start the agent's turns. */
  readonly sessions: Map<Id<"agt">, Id<"ses">>;
  readonly running: Map<Id<"agt">, RunningTurn>;
  readonly closing: Map<Id<"agt">, Id<"ses">>;
  /** No turn starts before this time; `Infinity` until the agent's next message. */
  readonly resumesAt: Map<Id<"agt">, number>;
  /** Agents whose chat queue held 200 messages, so one stayed in the engine's inbox. */
  readonly full: Set<Id<"agt">>;
  /** The wait before each agent's next goal turn, which a stop or another wait ends. */
  readonly goalWaits: Map<Id<"agt">, AbortController>;
  /** Each agent whose chats are being deleted, and what settles once the deletion ended. */
  readonly deleting: Map<Id<"agt">, Promise<void>>;
}

/** Creates the chats of an install with no agent seen yet. */
export function createAgentChats(): AgentChats {
  return {
    sessions: new Map(),
    running: new Map(),
    closing: new Map(),
    resumesAt: new Map(),
    full: new Set(),
    goalWaits: new Map(),
    deleting: new Map(),
  };
}
