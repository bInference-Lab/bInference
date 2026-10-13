import type { Id } from "@binference/core";
import type { LiveFactsView } from "@binference/protocol";
import type {
  EngineSay,
  EngineStatus,
  EngineTurn,
  EngineTurnEnd,
  EngineTurnStart,
  EngineUsage,
  InboxPage,
  InboxWatch,
  RecordedUsage,
  TurnStartAnswer,
  WorkspacePlace,
} from "./engine-chat-records.js";
import type { SkillIndexEntry } from "./skill-index-entry.js";

/**
 * The engine's side of chat, as the runtime reaches it with the token of its current start
 * (runtime spec, sections 3.2 and 4.3). Each call resolves once the engine answered; a call the
 * engine cannot answer, or that its signal aborts, rejects.
 */
export interface EngineChat {
  /** Watches the `inbox` topic; answers the call that ends the watch. */
  watchInbox(watch: InboxWatch): () => void;
  /** `inbox/list`: the untaken messages of every agent, oldest first, from a page's cursor. */
  listInbox(cursor: string | undefined, signal: AbortSignal): Promise<InboxPage>;
  /** `inbox/take`: the runtime holds these messages in its chat queue now. */
  takeInbox(messages: readonly Id<"msg">[], signal: AbortSignal): Promise<void>;
  /** `turn/start`: the engine starts the turn, or refuses it for its agent's state. */
  startTurn(start: EngineTurnStart, signal: AbortSignal): Promise<TurnStartAnswer>;
  /** `turn/mark`: the running turn holds outside content. */
  markTurn(turn: EngineTurn, signal: AbortSignal): Promise<void>;
  /** `turn/say`. */
  sayTurn(say: EngineSay, signal: AbortSignal): Promise<void>;
  /** `turn/status`. */
  turnStatus(status: EngineStatus, signal: AbortSignal): Promise<void>;
  /**
   * `usage/record`: answers what is left of the agent's model budget after the record, and when it
   * resumes once spent.
   */
  recordUsage(usage: EngineUsage, signal: AbortSignal): Promise<RecordedUsage>;
  /** `turn/end`: the engine's running turn for the agent clears. */
  endTurn(end: EngineTurnEnd, signal: AbortSignal): Promise<void>;
}

/**
 * What a turn's context reads from the engine (runtime spec, section 7.1): each of an agent's
 * workspace files, its skills, and its live facts. Each call rejects when the engine cannot
 * answer, and with the signal's reason once it aborts.
 */
export interface ContextSource {
  /** `agent/readFile`: the file's text, or `undefined` when the agent has no such file. */
  workspaceFile(place: WorkspacePlace, signal: AbortSignal): Promise<string | undefined>;
  /** `skill/list`: the skills the agent's index holds, by name; none from an engine that serves none. */
  skills(agent: Id<"agt">, signal: AbortSignal): Promise<readonly SkillIndexEntry[]>;
  /** `facts/get`: what the agent stands on now. */
  liveFacts(agent: Id<"agt">, signal: AbortSignal): Promise<LiveFactsView>;
}
