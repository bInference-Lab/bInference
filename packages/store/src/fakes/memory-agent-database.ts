import type { QueuedMessage } from "../chats/queued-message.js";
import type { SessionRecord } from "../chats/session-record.js";
import type { TranscriptEvent } from "../chats/transcript-event.js";
import type { TurnRecord } from "../chats/turn-record.js";
import type { NoteRecord } from "../notes/note-record.js";

/** A number that only grows. */
interface Counter {
  readonly value: () => number;
  /** Moves the count `by` forward and answers it. */
  readonly add: (by: number) => number;
}

function createCounter(): Counter {
  const count = { value: 0 };
  return {
    value: () => count.value,
    add(by) {
      count.value += by;
      return count.value;
    },
  };
}

/**
 * The rows of an in-memory agent database, which its in-memory stores share as the SQLite stores
 * share one file. A store reads and writes them only through its own methods.
 */
export interface MemoryAgentDatabase {
  readonly fence: Counter;
  readonly sessions: Map<string, SessionRecord>;
  readonly turns: Map<string, TurnRecord>;
  readonly events: TranscriptEvent[];
  /** The last number given to an event; numbers are never reused, as SQLite's are not. */
  readonly eventIds: Counter;
  readonly queue: Map<string, QueuedMessage>;
  readonly notes: Map<number, NoteRecord>;
  readonly noteIds: Counter;
}

/** Creates an empty in-memory agent database, with no fence raised yet. */
export function createMemoryAgentDatabase(): MemoryAgentDatabase {
  return {
    fence: createCounter(),
    sessions: new Map(),
    turns: new Map(),
    events: [],
    eventIds: createCounter(),
    queue: new Map(),
    notes: new Map(),
    noteIds: createCounter(),
  };
}

/**
 * Runs one call of an in-memory store: an aborted signal rejects with its reason, a write whose
 * fence is not the current one is `fenced`, and any other work runs at once.
 */
export async function inMemory<Output>(
  options: { readonly signal: AbortSignal },
  work: () => Output,
): Promise<Output> {
  options.signal.throwIfAborted();
  return Promise.resolve(work());
}

/** Whether a write made with `fence` may change the database: its fence is the current one. */
export function holdsFence(database: MemoryAgentDatabase, fence: number): boolean {
  return database.fence.value() === fence;
}
