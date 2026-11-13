import type { Result } from "@binference/core";
import type {
  IdempotencyEntry,
  IdempotencyLookup,
  IdempotencyRecall,
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
  /** Deletes results stored before `beforeMs` and returns how many. */
  prune(beforeMs: number, options: StoreCall): Promise<number>;
}
