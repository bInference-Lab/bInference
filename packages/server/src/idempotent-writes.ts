import { type Clock, err, type JsonValue, type Result } from "@binference/core";
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
 * refusal, `protocol.key_reused` for a key that holds other args, or `protocol.busy` when too many
 * writes are running.
 */
export type WriteOutcome = Result<JsonValue, ProtocolErrorCode>;

/** Runs each write once per key (protocol spec, section 5). */
export interface IdempotentWrites {
  /**
   * Answers a key that holds a result with that result, and a key that holds other args with
   * `protocol.key_reused`. A result that holds a webhook rule's URL is kept without it, and its
   * key answers `webhook.url_shown` from then on. Otherwise runs the write and stores its result before answering; a
   * refused write stores nothing. A call with a key whose write is still running waits for it, so
   * a write sent again after a reconnect runs once. A store fault rejects.
   */
  run(request: WriteRequest): Promise<WriteOutcome>;
}

/** What {@link IdempotentWrites} stores through and how many writes may run at once. */
export interface IdempotentWritesOptions {
  readonly store: IdempotencyStore;
  readonly clock: Clock;
  readonly maxInFlight: number;
  /** Aborts the store calls when the server stops; a call's own timeout never cuts a store write. */
  readonly signal: AbortSignal;
}

interface Running {
  readonly argsHash: string;
  readonly outcome: Promise<WriteOutcome>;
}

/** Creates the idempotent write runner over an {@link IdempotencyStore}. */
export function createIdempotentWrites(options: IdempotentWritesOptions): IdempotentWrites {
  const running = new Map<string, Running>();
  const store = { signal: options.signal };

  const settle = async (request: WriteRequest): Promise<WriteOutcome> => {
    const { op } = request.lookup;
    const recalled = await options.store.recall(request.lookup, store);
    if (recalled.kind !== "new") {
      return recalled.kind === "repeat"
        ? repeatedResult(op, recalled.result)
        : err("protocol.key_reused");
    }
    const done = await request.work();
    if (!done.ok) {
      return done;
    }
    // A result that holds a secret shown once is kept without it (decision 0337).
    const result = storableResult(op, done.value);
    const entry = { ...request.lookup, result, atMs: options.clock.now() };
    const remembered = await options.store.remember(entry, store);
    if (remembered.kind === "new") {
      return done;
    }
    return remembered.kind === "repeat"
      ? repeatedResult(op, remembered.result)
      : err("protocol.key_reused");
  };

  return {
    async run(request) {
      const { credential, op, key, argsHash } = request.lookup;
      const name = JSON.stringify([credential, op, key]);
      const before = running.get(name);
      if (before !== undefined) {
        return before.argsHash === argsHash ? before.outcome : err("protocol.key_reused");
      }
      if (running.size >= options.maxInFlight) {
        return err("protocol.busy");
      }
      const outcome = settle(request);
      running.set(name, { argsHash, outcome });
      try {
        return await outcome;
      } finally {
        running.delete(name);
      }
    },
  };
}
