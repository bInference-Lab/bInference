import type { Result } from "@binference/core";
import type {
  IdempotencyEntry,
  IdempotencyLookup,
  IdempotencyMark,
  IdempotencyPrune,
  IdempotencyRecall,
  IdempotencyStart,
} from "./idempotency-entry.js";
import type { InboxAdmission, InboxDraft, InboxEntry, InboxPage } from "./inbox-entry.js";

interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps every inbound Telegram update and webhook alert from before it is acknowledged. Adapters:
 * a SQLite store in `@binference/store`, and an in-memory fake.
 */
export interface InboxStore {
  /** Stores an event; a source key stored before is a `repeat` that returns the first entry. */
  admit(draft: InboxDraft, options: StoreCall): Promise<InboxAdmission>;
  /** Marks an entry handled; the first mark wins and a later one is `handled`. */
  markHandled(
    mark: { readonly id: number; readonly atMs: number },
    options: StoreCall,
  ): Promise<Result<InboxEntry, "not_found" | "handled">>;
  /**
   * Entries not handled yet whose source key starts with `keyPrefix`, oldest first, at most
   * `limit`: the work a restart resumes. Each source pages its own entries, so entries of another
   * source, or of a bot the install no longer runs, never fill a page.
   */
  unhandled(page: InboxPage, options: StoreCall): Promise<readonly InboxEntry[]>;
  /** Deletes entries handled before `beforeMs` and returns how many. */
  prune(beforeMs: number, options: StoreCall): Promise<number>;
}

/** Keeps each write's result under its idempotency key (protocol spec, section 5). */
export interface IdempotencyStore {
  /** What the store holds under the key, compared with the args hash. */
  recall(lookup: IdempotencyLookup, options: StoreCall): Promise<IdempotencyRecall>;
  /**
   * Stores a result under its key when the key is free, and answers `new`. A key that holds a
   * result keeps the first one: `repeat` returns it, `reused` says the args differ.
   */
  remember(entry: IdempotencyEntry, options: StoreCall): Promise<IdempotencyRecall>;
  /**
   * Reads a key and, when it is free, marks it started with its args hash and no result, in one
   * write, before the write runs (decision 0437); see {@link IdempotencyStart} for each answer.
   */
  start(mark: IdempotencyMark, options: StoreCall): Promise<IdempotencyStart>;
  /**
   * Stores a write's result in its key's started row, with the result's time, or again as a new
   * row when a prune took the mark. The same result again is done; a key with other args or one
   * that holds another result throws `store.constraint` and changes nothing.
   */
  finish(entry: IdempotencyEntry, options: StoreCall): Promise<void>;
  /**
   * Removes a started key with no result and the same args hash, so the key may run again; a key
   * that holds a result, other args or nothing is left as it is.
   */
  forget(lookup: IdempotencyLookup, options: StoreCall): Promise<void>;
  /**
   * Deletes the keys started or stored before the prune's time, but the marks of the writes it
   * names as running, and returns how many went.
   */
  prune(prune: IdempotencyPrune, options: StoreCall): Promise<number>;
}
