import type { Id, Result } from "@binference/core";
import type {
  AgentInboxDraft,
  AgentInboxMessage,
  InboxTake,
  UntakenQuery,
} from "./agent-inbox-record.js";

/**
 * Keeps the agent inbox (database spec, `agent_inbox`) and each agent's open chat session
 * (`agents.chat_session_id`): every message for the agent runtime, from the write of the event
 * that causes it until the runtime takes it into its chat queue (runtime spec, section 3.2). The
 * intent store writes a settle message with the move that ends an intent the runtime proposed;
 * this port writes the owner's.
 */
export interface AgentInboxStore {
  /**
   * Stores an owner's message in the agent's open session, opening the draft's `opens` when none
   * is open, and makes `next` the open session when the draft names it, all in one write. An
   * `inbox/message` while the agent holds 200 untaken messages is `busy`, and an unknown agent
   * `not_found`; either stores nothing. An id in use throws `store.constraint`.
   */
  add(
    draft: AgentInboxDraft,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<AgentInboxMessage, "busy" | "not_found">>;
  /** The agent's open session, or `undefined` before its first message or for an unknown agent. */
  openSession(
    agent: Id<"agt">,
    options: { readonly signal: AbortSignal },
  ): Promise<Id<"ses"> | undefined>;
  /** Untaken messages, the oldest first, then by id. */
  untaken(
    query: UntakenQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly AgentInboxMessage[]>;
  /**
   * Marks the messages taken at the take's time; one taken before keeps its first time, and an
   * unknown id is skipped. Answers how many this take marked.
   */
  take(take: InboxTake, options: { readonly signal: AbortSignal }): Promise<number>;
}
