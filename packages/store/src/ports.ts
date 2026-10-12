import type { Id, Result } from "@binference/core";
import type { ChatPrune, ChatPruned } from "./chats/chat-prune.js";
import type { FenceRefusal, Fenced } from "./chats/fenced.js";
import type {
  QueueDraft,
  QueueDrop,
  QueuedMessage,
  QueueTake,
  WaitingQuery,
} from "./chats/queued-message.js";
import type { SessionClose, SessionDraft, SessionRecord } from "./chats/session-record.js";
import type {
  CommittingAppend,
  EventAppend,
  EventQuery,
  TranscriptEvent,
} from "./chats/transcript-event.js";
import type { TurnDraft, TurnEnd, TurnRecord, TurnRef } from "./chats/turn-record.js";
import type {
  NoteDelete,
  NoteDraft,
  NoteList,
  NoteRecord,
  NoteSearch,
} from "./notes/note-record.js";

// The ports of `agent.sqlite` (database spec, section 3), which the agent runtime owns. They live
// here, beside their SQLite adapters, because the runtime builds on this package (decision 0170).

/** What every call takes. A call on an aborted signal rejects with its reason and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * The writer fence of `agent.sqlite` (runtime spec, section 2.3). Each runtime start raises it,
 * and every write checks the fence it was made with in its own transaction, so a runtime left over
 * from before writes nothing.
 */
export interface WriterFence {
  /** Raises the fence and answers its new value, 1 on a database that never had one. */
  raise(options: StoreCall): Promise<number>;
}

/** Keeps the chat sessions and their turns, under the ids the engine gave them. */
export interface SessionStore {
  /** Opens a session; an id in use is `exists`. */
  open(
    draft: Fenced<SessionDraft>,
    options: StoreCall,
  ): Promise<Result<SessionRecord, FenceRefusal | "exists">>;
  /** One session. */
  get(id: Id<"ses">, options: StoreCall): Promise<SessionRecord | undefined>;
  /** Closes a session at the version its closer read; `stale` at another, `closed` once closed. */
  close(
    close: Fenced<SessionClose>,
    options: StoreCall,
  ): Promise<Result<SessionRecord, FenceRefusal | "not_found" | "stale" | "closed">>;
  /** Starts a turn in an open session; an id in use is `exists`. */
  startTurn(
    draft: Fenced<TurnDraft>,
    options: StoreCall,
  ): Promise<Result<TurnRecord, FenceRefusal | "exists" | "no_session">>;
  /** Sets the turn's committed mark, which never clears; a turn that ended is `ended`. */
  commitTurn(
    ref: Fenced<TurnRef>,
    options: StoreCall,
  ): Promise<Result<TurnRecord, FenceRefusal | "not_found" | "ended">>;
  /** Sets the turn's outside-content mark, which never clears; a turn that ended is `ended`. */
  markOutside(
    ref: Fenced<TurnRef>,
    options: StoreCall,
  ): Promise<Result<TurnRecord, FenceRefusal | "not_found" | "ended">>;
  /** Ends a turn once, with its outcome and its held-back proposals. */
  endTurn(
    end: Fenced<TurnEnd>,
    options: StoreCall,
  ): Promise<Result<TurnRecord, FenceRefusal | "not_found" | "ended">>;
  /** One turn. */
  turn(id: Id<"trn">, options: StoreCall): Promise<TurnRecord | undefined>;
  /** The turns with no end, oldest first: those a crash left, which the next start repairs. */
  unfinishedTurns(options: StoreCall): Promise<readonly TurnRecord[]>;
}

/** Keeps each session's transcript, which only grows: no event ever changes. */
export interface TranscriptStore {
  /**
   * Appends events to a session in one write and answers them numbered, each `seq` one past the
   * last. A session the store does not hold is `no_session`; a turn it does not hold in that
   * session is `no_turn`. Nothing is written unless every event is.
   */
  append(
    append: Fenced<EventAppend>,
    options: StoreCall,
  ): Promise<Result<readonly TranscriptEvent[], FenceRefusal | "no_session" | "no_turn">>;
  /**
   * Appends a turn's events and sets its committed mark, in one write (runtime spec, section 6.1):
   * a propose call is stored with the mark before the engine hears of it. Refused as `append` is,
   * and `no_turn` when the turn is not the session's or an event names another, `ended` once the
   * turn ended; nothing is written unless all of it is.
   */
  appendCommitting(
    append: Fenced<CommittingAppend>,
    options: StoreCall,
  ): Promise<Result<readonly TranscriptEvent[], FenceRefusal | "no_session" | "no_turn" | "ended">>;
  /** A session's events after `afterSeq`, in order, at most `limit`. */
  events(query: EventQuery, options: StoreCall): Promise<readonly TranscriptEvent[]>;
}

/**
 * The chat queue (runtime spec, section 3.4): the messages the runtime took from the agent inbox,
 * each once, until a turn takes them or they are dropped.
 */
export interface ChatQueueStore {
  /** Adds a message; one already in the queue is `exists` and stays as it was. */
  add(
    draft: Fenced<QueueDraft>,
    options: StoreCall,
  ): Promise<Result<QueuedMessage, FenceRefusal | "exists">>;
  /** The waiting messages of a session, or of every session, oldest first, at most `limit`. */
  waiting(query: WaitingQuery, options: StoreCall): Promise<readonly QueuedMessage[]>;
  /** Gives the messages to a turn, all or none; one that does not wait is `not_waiting`. */
  take(
    take: Fenced<QueueTake>,
    options: StoreCall,
  ): Promise<Result<readonly QueuedMessage[], FenceRefusal | "not_waiting">>;
  /** Drops a waiting message with its reason. */
  drop(
    drop: Fenced<QueueDrop>,
    options: StoreCall,
  ): Promise<Result<QueuedMessage, FenceRefusal | "not_found" | "not_waiting">>;
}

/** Keeps each agent's notes, searchable by full text in any language. */
export interface NoteStore {
  /** Writes a note with its origin and answers it with its number. */
  write(draft: Fenced<NoteDraft>, options: StoreCall): Promise<Result<NoteRecord, FenceRefusal>>;
  /** Removes a note from lists and searches; one removed before is `not_found`. */
  delete(
    removal: Fenced<NoteDelete>,
    options: StoreCall,
  ): Promise<Result<NoteRecord, FenceRefusal | "not_found">>;
  /** An agent's notes that are not removed, oldest first. */
  list(query: NoteList, options: StoreCall): Promise<readonly NoteRecord[]>;
  /**
   * An agent's notes that are not removed and whose text holds the query, the best match first.
   * Matching is by runs of three characters, ignoring letter case, so it finds a word inside
   * Chinese text; a query shorter than three characters is looked for as a substring, ignoring
   * the case of ASCII letters, oldest note first.
   */
  search(query: NoteSearch, options: StoreCall): Promise<readonly NoteRecord[]>;
}

/**
 * Removes the chats older than `chats.keepDays` (database spec, section 4; decision 0169), in one
 * write: the transcript events older than the cutoff, the turns that ended before it and hold no
 * event, and the chat queue's messages received before it that a turn took or that were dropped.
 * Sessions, notes and waiting messages stay.
 */
export interface ChatRetention {
  /** Prunes before the cutoff and answers how many rows of each table went. */
  prune(prune: Fenced<ChatPrune>, options: StoreCall): Promise<Result<ChatPruned, FenceRefusal>>;
}
