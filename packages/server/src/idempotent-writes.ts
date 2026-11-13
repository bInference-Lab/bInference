import {
  BinferenceError,
  type Clock,
  createDeadline,
  err,
  type JsonValue,
  type Logger,
  type Result,
} from "@binference/core";
import type { IdempotencyLookup, IdempotencyStore } from "@binference/engine";
import { type ProtocolErrorCode, repeatedResult, storableResult } from "@binference/protocol";

/** One write to run once per idempotency key. */
interface WriteRequest {
  readonly lookup: IdempotencyLookup;
  /** Runs the write and gives its result as wire JSON, or refuses it. */
  readonly work: () => Promise<Result<JsonValue, ProtocolErrorCode>>;
}

/**
 * A write's result: the first result stored under its key, or why there is none: the handler's
 * refusal, `protocol.key_reused` for a key that holds other args, `protocol.outcome_unknown` for
 * a key whose write never stored its result, or `protocol.busy` when too many writes run.
 */
export type WriteOutcome = Result<JsonValue, ProtocolErrorCode>;

/** Runs each write once per key (protocol spec, section 5; decision 0437). */
export interface IdempotentWrites {
  /**
   * Answers a key that holds a result with that result, and a key that holds other args with
   * `protocol.key_reused`. A result that holds a webhook rule's URL is kept without it, and its
   * key answers `webhook.url_shown` from then on. Otherwise marks the key started in the store,
   * runs the write and stores its result before answering. A write its handler refuses frees its
   * key; one whose handler throws keeps it, since part of it may have run. A call with a key whose
   * write this engine start runs waits for it, so a write sent again after a reconnect runs once;
   * a key started with no result that no write of this start runs answers
   * `protocol.outcome_unknown`. A store fault rejects.
   */
  run(request: WriteRequest): Promise<WriteOutcome>;
  /**
   * Deletes the keys started or stored more than 24 hours ago, but the marks of the writes this
   * engine start still runs, and answers how many went.
   */
  prune(options: { readonly signal: AbortSignal }): Promise<number>;
  /** Resolves once every result and freed key being stored now is stored or failed. */
  settled(): Promise<void>;
}

/** What {@link IdempotentWrites} stores through and how many writes may run at once. */
export interface IdempotentWritesOptions {
  readonly store: IdempotencyStore;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly maxInFlight: number;
  /**
   * Aborts the marks when the server stops; a call's own timeout never cuts a store write. A
   * result or a freed key is stored on a deadline of its own, so a stop never loses one.
   */
  readonly signal: AbortSignal;
}

interface Running {
  readonly lookup: IdempotencyLookup;
  readonly outcome: Promise<WriteOutcome>;
}

/** How long a key is kept: 24 hours from its mark or its result (database spec, section 4). */
const keptMs = 86_400_000;

/** How long storing a result or freeing a key may take. */
const settleMs = 5_000;

const never = new AbortController().signal;

/** The writes of one engine start: those it runs, and the results it is storing. */
interface Writes {
  readonly options: IdempotentWritesOptions;
  readonly storing: Set<Promise<void>>;
}

// Stores a result or frees a key on its own deadline, never the server's stop signal, so a
// write that ended as the engine stops still keeps its answer; the stop waits for it.
async function onOwnDeadline(
  writes: Writes,
  step: (call: { readonly signal: AbortSignal }) => Promise<void>,
): Promise<void> {
  const deadline = createDeadline({
    clock: writes.options.clock,
    signal: never,
    timeoutMs: settleMs,
  });
  const storing = step({ signal: deadline.signal }).finally(() => deadline.clear());
  writes.storing.add(storing);
  try {
    await storing;
  } finally {
    writes.storing.delete(storing);
  }
}

// A key left started reads as unknown, which fails closed: the log says why it was not freed.
async function forget(writes: Writes, lookup: IdempotencyLookup): Promise<void> {
  try {
    await onOwnDeadline(writes, async (call) => writes.options.store.forget(lookup, call));
  } catch (fault) {
    const errorCode = fault instanceof BinferenceError ? fault.code : "unexpected";
    writes.options.logger.warn("server.key_kept", { errorCode });
  }
}

// A result left unstored keeps its key started, so a resend answers as unknown: the log says why.
async function finish(writes: Writes, request: WriteRequest, value: JsonValue): Promise<void> {
  const { store, clock, logger } = writes.options;
  // A result that holds a secret shown once is kept without it (decision 0337).
  const result = storableResult(request.lookup.op, value);
  const entry = { ...request.lookup, result, atMs: clock.now() };
  try {
    await onOwnDeadline(writes, async (call) => store.finish(entry, call));
  } catch (fault) {
    const errorCode = fault instanceof BinferenceError ? fault.code : "unexpected";
    logger.warn("server.result_unkept", { errorCode });
    throw fault;
  }
}

// A thrown write keeps its mark whatever the fault: part of it may have run (decision 0437).
async function runStarted(writes: Writes, request: WriteRequest): Promise<WriteOutcome> {
  const done = await request.work();
  if (!done.ok) {
    await forget(writes, request.lookup);
    return done;
  }
  await finish(writes, request, done.value);
  return done;
}

async function settle(writes: Writes, request: WriteRequest): Promise<WriteOutcome> {
  const { store, clock, signal } = writes.options;
  const mark = { ...request.lookup, atMs: clock.now() };
  const started = await store.start(mark, { signal });
  if (started.kind === "repeat") {
    return repeatedResult(request.lookup.op, started.result);
  }
  if (started.kind === "reused") {
    return err("protocol.key_reused");
  }
  if (started.kind === "unfinished") {
    return err("protocol.outcome_unknown");
  }
  return runStarted(writes, request);
}

/** Creates the idempotent write runner over an {@link IdempotencyStore}. */
export function createIdempotentWrites(options: IdempotentWritesOptions): IdempotentWrites {
  const running = new Map<string, Running>();
  const writes: Writes = { options, storing: new Set() };
  return {
    async run(request) {
      const { credential, op, key, argsHash } = request.lookup;
      const name = JSON.stringify([credential, op, key]);
      const before = running.get(name);
      if (before !== undefined) {
        return before.lookup.argsHash === argsHash ? before.outcome : err("protocol.key_reused");
      }
      if (running.size >= options.maxInFlight) {
        return err("protocol.busy");
      }
      const outcome = settle(writes, request);
      running.set(name, { lookup: request.lookup, outcome });
      try {
        return await outcome;
      } finally {
        running.delete(name);
      }
    },
    prune: async (call) => {
      const kept = [...running.values()].map(({ lookup }) => lookup);
      const beforeMs = options.clock.now() - keptMs;
      return options.store.prune({ beforeMs, running: kept }, call);
    },
    settled: async () => {
      await Promise.allSettled(writes.storing);
    },
  };
}
