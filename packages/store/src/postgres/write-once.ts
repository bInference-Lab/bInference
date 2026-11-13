import { BinferenceError, type Clock, type Logger, type Random } from "@binference/core";
import type { Kysely } from "kysely";
import { readCommitIdentity } from "./commit-identity.js";
import { type CommitIdentity, type CommitStatus, resolveCommit } from "./commit-step.js";
import { connectionOf, type PostgresConnection } from "./postgres-connection.js";
import { commitUnknown, sqlStateOf } from "./postgres-error.js";

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

/** A write's ports, the signal that stops it, and where it asks how a lost commit ended. */
export interface WriteOptions extends RetryPorts {
  readonly signal: AbortSignal;
  readonly status: CommitStatus;
}

/** One try's end: the task's output, or a lost commit the database says did not land. */
export type Tried<Output> =
  | { readonly kind: "done"; readonly output: Output }
  | { readonly kind: "rerun" };

/** What a write left once its task ended, before `COMMIT`. */
interface Kept<Output> {
  readonly output: Output;
  readonly identity: CommitIdentity;
}

/** One try under way: its transaction, what it kept before `COMMIT`, and its status check. */
interface Running<Output> {
  readonly transaction: Promise<Output>;
  readonly kept: { readonly value?: Kept<Output> };
  /** Starts the try's one status check, or answers the one already started. */
  checkOnce(start: () => Promise<Tried<Output>>): Promise<Tried<Output>>;
  /** The status check, once one started. */
  checked(): Promise<Tried<Output>> | undefined;
}

function ignore(): void {
  // Nothing waits for it any more.
}

function landed<Output>(output: Output): Tried<Output> {
  return { kind: "done", output };
}

// A COMMIT the server refused rolled back; one whose connection was lost may have landed.
function isLostCommit(error: Error["cause"]): boolean {
  return sqlStateOf(error) === undefined && !(error instanceof BinferenceError);
}

// Asks the database how a write whose COMMIT answer was lost ended (decision 0438), until `stop`.
async function settleLost<Output>(
  kept: Kept<Output>,
  options: WriteOptions,
  stop: AbortSignal,
): Promise<Tried<Output>> {
  const end = await resolveCommit(kept.identity, {
    status: options.status,
    clock: options.clock,
    stop,
  });
  options.logger.warn("store.commit_lost", { errorCode: end });
  if (end === "committed") {
    return { kind: "done", output: kept.output };
  }
  if (end === "rerun") {
    return { kind: "rerun" };
  }
  throw commitUnknown(undefined, kept.identity.transactionId);
}

function begin<Schema, Output>(
  db: Kysely<Schema>,
  work: PostgresWork<Schema, Output>,
  signal: AbortSignal,
): Running<Output> {
  const kept: { value?: Kept<Output> } = {};
  const transaction = db
    .transaction()
    .setIsolationLevel("serializable")
    .setAccessMode("read write")
    .execute(async (trx) => {
      const connection = connectionOf(trx, signal);
      const output = await work(connection);
      const identity = await readCommitIdentity(connection);
      // An abort before COMMIT throws here, and the transaction rolls back.
      signal.throwIfAborted();
      kept.value = { output, identity };
      return output;
    });
  // The try's answer reads it; once that is given, only the connection's release waits for it.
  void transaction.catch(ignore);
  let check: Promise<Tried<Output>> | undefined;
  return {
    transaction,
    kept,
    checkOnce: async (start) => {
      check ??= start();
      return check;
    },
    checked: () => check,
  };
}

// Resolves with what the write kept once the signal aborts while its COMMIT runs.
function doubtOf<Output>(
  signal: AbortSignal,
  kept: { value?: Kept<Output> },
): { readonly doubt: Promise<Kept<Output>>; readonly done: () => void } {
  let resolve: (value: Kept<Output>) => void = ignore;
  const doubt = new Promise<Kept<Output>>((settle) => {
    resolve = settle;
  });
  const onAbort = (): void => {
    if (kept.value !== undefined) {
      resolve(kept.value);
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return { doubt, done: () => signal.removeEventListener("abort", onAbort) };
}

// After an abort while COMMIT runs, COMMIT's own answer or the database's, whichever comes first;
// a COMMIT whose connection was lost gives no answer of its own.
async function inDoubt<Output>(
  running: Running<Output>,
  kept: Kept<Output>,
  options: WriteOptions & { readonly stop: AbortSignal },
): Promise<Tried<Output>> {
  const check = running.checkOnce(async () => settleLost(kept, options, options.stop));
  const own = running.transaction.then(landed, async (error: Error["cause"]) =>
    isLostCommit(error) ? check : Promise.reject(error),
  );
  return Promise.race([own, check]);
}

async function answerOf<Output>(
  running: Running<Output>,
  options: WriteOptions & { readonly stop: AbortSignal },
): Promise<Tried<Output>> {
  const watch = doubtOf(options.signal, running.kept);
  try {
    const first = await Promise.race([running.transaction.then(landed), watch.doubt]);
    return "kind" in first ? first : await inDoubt(running, first, options);
  } catch (error) {
    const { value } = running.kept;
    if (value === undefined || !isLostCommit(error)) {
      throw error;
    }
    return await running.checkOnce(async () => settleLost(value, options, options.stop));
  } finally {
    watch.done();
  }
}

/**
 * Runs `work` once in one `SERIALIZABLE`, read-write transaction and commits, on a connection it
 * keeps until both `COMMIT` answered and any status check stopped, so no other call takes a
 * session the check may end (decision 0438). A connection lost while `COMMIT` is in flight asks the
 * database how the transaction ended. After an abort while `COMMIT` runs, `COMMIT`'s own answer
 * and the database's race, and the first decides: committed answers the task's output, not
 * committed answers `rerun`, and one the database cannot tell about throws `store.commit_unknown`.
 * An abort before `COMMIT` rolls back; every other failure throws as it came.
 */
export async function writeOnce<Schema, Output>(
  kysely: Kysely<Schema>,
  work: PostgresWork<Schema, Output>,
  options: WriteOptions,
): Promise<Tried<Output>> {
  options.signal.throwIfAborted();
  let give: (answer: Promise<Tried<Output>>) => void = ignore;
  const answered = new Promise<Tried<Output>>((resolve) => {
    give = resolve;
  });
  const held = kysely.connection().execute(async (db) => {
    const stop = new AbortController();
    const running = begin(db, work, options.signal);
    const answer = answerOf(running, { ...options, stop: stop.signal });
    give(answer);
    await answer.then(ignore, ignore);
    stop.abort();
    await Promise.allSettled([running.transaction, running.checked()]);
  });
  // A connection the pool never gave fails the try before it has an answer.
  held.catch((error: Error["cause"]) => give(Promise.reject(error)));
  return answered;
}
