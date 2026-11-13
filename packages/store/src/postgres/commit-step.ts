import type { Clock } from "@binference/core";

/**
 * What a write reads in its own transaction before `COMMIT`, so it can ask how the transaction
 * ended once `COMMIT`'s answer is lost (decision 0438): the transaction's id, if it wrote anything,
 * its session's process id and start, and the server's start time, all as the server writes them.
 */
export interface CommitIdentity {
  readonly transactionId?: string;
  readonly processId: number;
  readonly sessionStart: string;
  readonly serverStart: string;
}

/** What one ask of the database found out about a write's transaction. */
export type CommitReading =
  | { readonly kind: "unreachable" }
  | { readonly kind: "other_server" }
  | {
      readonly kind: "status";
      /** `pg_xact_status`: empty once the server no longer keeps the transaction's status. */
      readonly status: "committed" | "aborted" | "in progress" | undefined;
      /** Whether the write's own session, by its process id and start, still runs. */
      readonly isAlive: boolean;
    };

/** What one ask or session end may spend. */
export interface CommitCall {
  /** What is left of the check's 10 s: the call gives up once it has passed. */
  readonly timeoutMs: number;
  /** Aborts once `COMMIT`'s own answer came, and the call gives up at once. */
  readonly signal: AbortSignal;
}

/** Asks the database about a write's transaction, on a connection of its own. */
export interface CommitStatus {
  /**
   * One ask; a connection or a query that fails, or runs past `call`, is `unreachable`, never a
   * throw.
   */
  ask(identity: CommitIdentity, call: CommitCall): Promise<CommitReading>;
  /**
   * Ends the write's session if it is still the same one in the write's own transaction, and
   * waits up to 2 s, within `call`, for it to go.
   */
  end(identity: CommitIdentity, call: CommitCall): Promise<void>;
}

/** How a write whose `COMMIT` answer was lost ended, as far as the database could tell. */
export type CommitEnd = "committed" | "rerun" | "unknown";

/** The next thing to do about a lost `COMMIT` answer, from one reading. */
export type CommitStep = CommitEnd | "ask_again" | "end_session";

// The bounds of decision 0438: asks 100 ms apart, the session ended after 3 s, all within 10 s.
const commitCheck = {
  askEveryMs: 100,
  endSessionAfterMs: 3_000,
  boundMs: 10_000,
} as const;

/** Where a check stands: the time since its first ask, and whether it ended the session. */
export interface CheckProgress {
  readonly elapsedMs: number;
  readonly hasEnded: boolean;
}

function isPast(progress: CheckProgress, ms: number): boolean {
  return progress.elapsedMs >= ms;
}

// What a reading says on its own, or `undefined` while the transaction is in progress or the
// database did not answer.
function endOf(reading: CommitReading): CommitEnd | undefined {
  if (reading.kind === "other_server") {
    return "unknown";
  }
  if (reading.kind !== "status" || reading.status === "in progress") {
    return undefined;
  }
  if (reading.status === undefined) {
    return "unknown";
  }
  return reading.status === "committed" ? "committed" : "rerun";
}

/**
 * The next step after a reading (decision 0438): a committed transaction answers its task's output,
 * an aborted one runs again, one still in progress is asked about again and its session ended after
 * 3 s, only while that session still runs; another server start, a status the server no longer
 * keeps, or no answer within 10 s cannot tell.
 */
export function nextCommitStep(reading: CommitReading, progress: CheckProgress): CommitStep {
  const end = endOf(reading);
  if (end !== undefined) {
    return end;
  }
  if (isPast(progress, commitCheck.boundMs)) {
    return "unknown";
  }
  const isHeld = reading.kind === "status" && reading.isAlive && !progress.hasEnded;
  return isHeld && isPast(progress, commitCheck.endSessionAfterMs) ? "end_session" : "ask_again";
}

/** What a check asks with, and the signal that stops it once `COMMIT`'s own answer came. */
export interface CheckParts {
  readonly status: CommitStatus;
  readonly clock: Clock;
  readonly stop: AbortSignal;
}

// What is left of the bound once `progress` passed.
function callAfter(progress: CheckProgress, stop: AbortSignal): CommitCall {
  return { timeoutMs: commitCheck.boundMs - progress.elapsedMs, signal: stop };
}

async function askFrom(
  identity: CommitIdentity,
  parts: CheckParts,
  since: { readonly startedMs: number; readonly hasEnded: boolean },
): Promise<CommitEnd> {
  parts.stop.throwIfAborted();
  const before = { elapsedMs: parts.clock.now() - since.startedMs, hasEnded: since.hasEnded };
  if (isPast(before, commitCheck.boundMs)) {
    return "unknown";
  }
  const reading = await parts.status.ask(identity, callAfter(before, parts.stop));
  parts.stop.throwIfAborted();
  const progress = { ...before, elapsedMs: parts.clock.now() - since.startedMs };
  const step = nextCommitStep(reading, progress);
  if (step === "end_session") {
    await parts.status.end(identity, callAfter(progress, parts.stop));
    return askFrom(identity, parts, { ...since, hasEnded: true });
  }
  if (step !== "ask_again") {
    return step;
  }
  await parts.clock.sleep(commitCheck.askEveryMs, parts.stop);
  return askFrom(identity, parts, since);
}

/**
 * Finds how a write whose `COMMIT` answer was lost ended, by asking the database every 100 ms for
 * up to 10 s, whatever the caller's signal (decision 0438): each ask and session end gets only
 * what is left of the 10 s, and none starts once they passed. `parts.stop` ends the check where it
 * is, rejecting with its reason, once `COMMIT`'s own answer came. A write with no transaction id
 * wrote nothing, so it runs again without an ask.
 */
export async function resolveCommit(
  identity: CommitIdentity,
  parts: CheckParts,
): Promise<CommitEnd> {
  if (identity.transactionId === undefined) {
    return "rerun";
  }
  return askFrom(identity, parts, { startedMs: parts.clock.now(), hasEnded: false });
}
