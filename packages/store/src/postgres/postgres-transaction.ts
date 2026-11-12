import { BinferenceError, type Clock, type Logger, type Random } from "@binference/core";
import { type Kysely, sql } from "kysely";
import { connectionOf, type PostgresConnection } from "./postgres-connection.js";
import {
  commitUnknown,
  isUniqueViolation,
  isWriteConflict,
  sqlStateOf,
  storeFaultOf,
  writeConflict,
} from "./postgres-error.js";

/** The work of one transaction. It makes no network call but its queries, and returns only data. */
export type PostgresWork<Schema, Output> = (
  connection: PostgresConnection<Schema>,
) => Promise<Output>;

/** What a write's retries wait through and report to. */
export interface RetryPorts {
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
}

/** A write's ports and the signal that stops it. */
export interface WriteOptions extends RetryPorts {
  readonly signal: AbortSignal;
}

/** The waits before each retry of a write that met a conflict (decision 0366). */
const conflictWaitsMs: readonly number[] = [10, 40, 160];

// Up to half a wait more, so writers that met each other do not meet again in step.
function jittered(waitMs: number, random: Random): number {
  const [byte = 0] = random.bytes(1);
  return waitMs + Math.floor((waitMs * byte) / 512);
}

function ignore(): void {
  // Nothing waits for it any more.
}

async function writeOnce<Schema, Output>(
  kysely: Kysely<Schema>,
  work: PostgresWork<Schema, Output>,
  signal: AbortSignal,
): Promise<Output> {
  signal.throwIfAborted();
  let committing = false;
  const running = kysely
    .transaction()
    .setIsolationLevel("serializable")
    .setAccessMode("read write")
    .execute(async (transaction) => {
      const output = await work(connectionOf(transaction, signal));
      // An abort before COMMIT throws here, and the transaction rolls back.
      signal.throwIfAborted();
      committing = true;
      return output;
    });
  let refuse: (fault: BinferenceError) => void = ignore;
  const aborted = new Promise<never>((_resolve, reject) => {
    refuse = reject;
  });
  const onAbort = (): void => {
    if (committing) {
      refuse(commitUnknown(signal.reason));
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });
  // The COMMIT may still settle after an abort stopped the wait; its outcome is unknown either way.
  void running.catch(ignore);
  try {
    return await Promise.race([running, aborted]);
  } catch (error) {
    // A COMMIT that the server refused rolled back; one that lost its connection may have landed.
    throw committing && sqlStateOf(error) === undefined && !(error instanceof BinferenceError)
      ? commitUnknown(error)
      : error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Runs `work` in one `SERIALIZABLE`, read-write transaction and commits. A conflict (SQLSTATE
 * 40001 or 40P01) runs it again from its first read, at most three times more after 10, 40 and
 * 160 ms with jitter, each retry logged; then it throws `store.write_conflict`. A unique or
 * exclusion key in use (23505 or 23P01) runs it again once, inside the same three, since a writer
 * that did not read the key meets a concurrent insert of it so (decision 0413); a second one, or
 * one with no retry left, throws `store.constraint`. A connection lost or the signal aborted while
 * `COMMIT` is in flight throws `store.commit_unknown`, never retried: the caller replays the write,
 * which answers as its first run did. An abort before `COMMIT` rolls back.
 */
export async function postgresWrite<Schema, Output>(
  kysely: Kysely<Schema>,
  work: PostgresWork<Schema, Output>,
  options: WriteOptions,
): Promise<Output> {
  const first = { attempt: 0, startedMs: options.clock.now(), hasRerunUnique: false };
  return writeFrom(kysely, work, { ...options, ...first });
}

/** Where a write stands among its tries. */
interface Attempt {
  readonly attempt: number;
  readonly startedMs: number;
  /** Whether a unique violation already ran it again: a second one is a real constraint. */
  readonly hasRerunUnique: boolean;
}

// The failure a write throws when it may not run again; `undefined` when it may.
function finalFault(
  error: Error["cause"],
  options: WriteOptions & Attempt,
): { readonly fault: Error["cause"] } | undefined {
  const isUnique = isUniqueViolation(error) && !options.hasRerunUnique;
  if (!isWriteConflict(error) && !isUnique) {
    return { fault: storeFaultOf(error, options.signal) };
  }
  if (conflictWaitsMs[options.attempt] !== undefined) {
    return undefined;
  }
  const fault = isUnique
    ? storeFaultOf(error, options.signal)
    : writeConflict(options.attempt + 1, error);
  return { fault };
}

async function writeFrom<Schema, Output>(
  kysely: Kysely<Schema>,
  work: PostgresWork<Schema, Output>,
  options: WriteOptions & Attempt,
): Promise<Output> {
  try {
    return await writeOnce(kysely, work, options.signal);
  } catch (error) {
    const final = finalFault(error, options);
    if (final !== undefined) {
      throw final.fault;
    }
    options.logger.warn("store.write_retried", {
      errorCode: sqlStateOf(error) ?? "",
      durationMs: options.clock.now() - options.startedMs,
    });
    const waitMs = conflictWaitsMs[options.attempt] ?? 0;
    await options.clock.sleep(jittered(waitMs, options.random), options.signal);
    const hasRerunUnique = options.hasRerunUnique || isUniqueViolation(error);
    return writeFrom(kysely, work, { ...options, attempt: options.attempt + 1, hasRerunUnique });
  }
}

/**
 * Cancels the statement the server process with this id runs, on a connection of its own. It never
 * rejects: a cancel that fails is logged, and the statement runs on until its timeout ends it.
 */
export type CancelBackend = (processId: number) => Promise<void>;

/**
 * Runs `work` in one `REPEATABLE READ`, read-only transaction, so every query in it sees one
 * snapshot. An abort cancels the running query on the server through `cancel`. Nothing is
 * retried.
 */
export async function postgresRead<Schema, Output>(
  kysely: Kysely<Schema>,
  work: PostgresWork<Schema, Output>,
  options: { readonly signal: AbortSignal; readonly cancel: CancelBackend },
): Promise<Output> {
  const { signal } = options;
  signal.throwIfAborted();
  try {
    return await kysely
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (transaction) => {
        const connection = connectionOf(transaction, signal);
        const backend = await connection.takeFirst(
          sql<{ pid: number }>`select pg_backend_pid() as pid`.compile(transaction),
        );
        // Kysely's own cancel misses a query inside a transaction: the rollback that follows the
        // abort takes the place of the query it would cancel (decision 0368). This one cancels
        // by process, and the transaction keeps its connection until the cancel has ended, so
        // the cancel can never reach a statement of the next call that takes the connection.
        let cancelling = Promise.resolve();
        const onAbort = (): void => {
          cancelling = options.cancel(backend?.pid ?? 0);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          return await work(connection);
        } finally {
          signal.removeEventListener("abort", onAbort);
          await cancelling;
        }
      });
  } catch (error) {
    throw storeFaultOf(error, signal);
  }
}
