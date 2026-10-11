import type { Id, Result } from "@binference/core";
import type { FenceRefusal, Fenced } from "./chats/fenced.js";
import type { SessionClose, SessionDraft, SessionRecord } from "./chats/session-record.js";
import type { EventAppend, EventQuery, TranscriptEvent } from "./chats/transcript-event.js";
import type { TurnDraft, TurnEnd, TurnRecord, TurnRef } from "./chats/turn-record.js";

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
  /** A session's events after `afterSeq`, in order, at most `limit`. */
  events(query: EventQuery, options: StoreCall): Promise<readonly TranscriptEvent[]>;
}
