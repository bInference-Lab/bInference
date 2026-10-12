import type { Id } from "@binference/core";
import type {
  EngineSay,
  EngineStatus,
  EngineTurn,
  EngineTurnEnd,
  EngineTurnStart,
  EngineUsage,
  InboxPage,
  InboxWatch,
  TurnStartAnswer,
} from "./engine-chat-records.js";

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
  /** `usage/record`: answers what is left of the agent's model budget after the record. */
  recordUsage(usage: EngineUsage, signal: AbortSignal): Promise<bigint>;
  /** `turn/end`: the engine's running turn for the agent clears. */
  endTurn(end: EngineTurnEnd, signal: AbortSignal): Promise<void>;
}
