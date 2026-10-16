import type { Id, Result } from "@binference/core";
import type {
  AgentInboxDraft,
  AgentInboxMessage,
  InboxTake,
  UntakenQuery,
} from "./agent-inbox-record.js";
import type {
  QuestionAnswerDraft,
  QuestionClosing,
  QuestionCopy,
  QuestionRecord,
} from "./question-record.js";

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
  /** One stored message, taken or not, or `undefined` for an id the inbox does not hold. */
  get(
    id: Id<"msg">,
    options: { readonly signal: AbortSignal },
  ): Promise<AgentInboxMessage | undefined>;
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

/**
 * Keeps the agent's questions to the owner and each surface's copy of them (database spec,
 * `questions` and `question_messages`): at most one open question per agent, and the answer
 * stored with its `inbox/message` in one write, so it reaches the runtime once.
 */
export interface QuestionStore {
  /**
   * Stores a new open question and closes the agent's open one in the same write: `expired` when
   * it is 24 hours old at the new one's time, else `replaced`. Answers the new question and the one
   * it closed. An id or reference in use throws `store.constraint`.
   */
  ask(
    question: QuestionRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<{ readonly asked: QuestionRecord; readonly closed?: QuestionRecord }>;
  /** One question, or `undefined` for an unknown id. */
  get(
    id: Id<"qst">,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionRecord | undefined>;
  /** The question whose buttons carry this reference, or `undefined`. */
  byRef(
    ref: string,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionRecord | undefined>;
  /** The agent's open question, expired or not, or `undefined`. */
  openOf(
    agent: Id<"agt">,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionRecord | undefined>;
  /**
   * Answers an open question that has not expired at the answer's time, and stores its
   * `inbox/message` in the agent's open session, all in one write. Any other question is `closed`,
   * an unknown one `not_found`, and an agent holding 200 untaken messages `busy`; each stores
   * nothing.
   */
  answer(
    draft: QuestionAnswerDraft,
    options: { readonly signal: AbortSignal },
  ): Promise<
    Result<
      { readonly question: QuestionRecord; readonly message: AgentInboxMessage },
      "closed" | "not_found" | "busy"
    >
  >;
  /**
   * Closes a question that is still open, with the reason, and answers it; `undefined` when it is
   * unknown or no longer open.
   */
  close(
    closing: QuestionClosing,
    options: { readonly signal: AbortSignal },
  ): Promise<QuestionRecord | undefined>;
  /** Keeps a surface's copy; keeping the same message again changes nothing. */
  keepCopy(copy: QuestionCopy, options: { readonly signal: AbortSignal }): Promise<void>;
  /** The copies of a question, in the order they were sent. */
  copies(
    question: Id<"qst">,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly QuestionCopy[]>;
}

/** Why the source of an owner's image cannot give it: over 5 MiB, or gone from the source. */
export type ImageRefusal = "too_large" | "unreadable";

/**
 * Reads the owner's images by the name a message gives them: an upload id, or `tg:<file_id>` for
 * a photo the owner's bot received (protocol spec, section 7.7). It never reads more than 5 MiB of
 * one: a larger image is `too_large`. An image the source no longer has, or never had, is
 * `unreadable`. A source that does not answer throws, `telegram.unreachable` for the bot. Rejects
 * with the signal's reason once it aborts. The bytes are never logged.
 */
export interface OwnerImageSource {
  read(
    image: string,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<Uint8Array, ImageRefusal>>;
}
