import type { Brand, Id, Result } from "@binference/core";
import { z } from "zod";

/** A worker process's id, unique per start: the `worker_id` of the lease rows it holds. */
export type WorkerId = Brand<string, "WorkerId">;

const workerIdPattern = /^[!-~]{1,128}$/;

function isWorkerId(text: string): text is WorkerId {
  return workerIdPattern.test(text);
}

/** Parses a worker id: 1 to 128 visible ASCII characters. */
export const workerIdSchema: z.ZodType<WorkerId, string> = z
  .string()
  .refine(isWorkerId, { message: "Expected a worker id: 1 to 128 visible ASCII characters." });

/**
 * How often a holder renews its lease, and how far ahead of the database's clock each take and
 * renewal sets the expiry (spec 3, section 6.5).
 */
export interface LeaseTimes {
  readonly renewEveryMs: number;
  readonly leaseMs: number;
}

/**
 * The starting values of spec 3, section 6.5: renew every 2 seconds, expire 6 seconds ahead, so a
 * dead worker's installs move within 10 seconds. The failover suite tunes them.
 */
export const leaseTimes: LeaseTimes = { renewEveryMs: 2_000, leaseMs: 6_000 };

/** A lease a take answered: one install held by one worker under one fence. */
export interface HeldLease {
  readonly installId: Id<"ins">;
  readonly workerId: WorkerId;
  /** The fence every row of the install carries while this worker holds it. */
  readonly fence: number;
  /** When the take ran, on the database's clock, in epoch milliseconds. */
  readonly takenAtMs: number;
  /** When the lease frees unless renewed, on the database's clock, in epoch milliseconds. */
  readonly expiresAtMs: number;
}

/**
 * One row of the shared schema's `agent_leases` (spec 3, section 6.5): the install's own row has
 * an empty `agentId` (decision 0418), and a free row no worker, take or renewal.
 */
export interface LeaseRow {
  readonly agentId: string;
  readonly workerId: string | null;
  readonly fence: number;
  readonly takenAtMs: number | null;
  readonly renewedAtMs: number | null;
  readonly expiresAtMs: number;
}

/**
 * Whether `rows`, read at `nowMs` on the database's clock, still give the install to `lease`:
 * there is a row, and each names the lease's worker and fence and has not expired. A row expires
 * once its `expiresAtMs` is at or before now.
 */
export function holdsLease(rows: readonly LeaseRow[], lease: HeldLease, nowMs: number): boolean {
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.workerId === lease.workerId && row.fence === lease.fence && row.expiresAtMs > nowMs,
    )
  );
}

/** What every call takes: a call on an aborted signal rejects with its reason, changing nothing. */
interface LeaseCall {
  readonly signal: AbortSignal;
}

/** Which install a worker asks to take. */
export interface LeaseTake {
  readonly installId: Id<"ins">;
  readonly workerId: WorkerId;
}

/**
 * The install leases of a Postgres database (spec 3, section 6.5, decision 0418). A worker holds
 * an install, with every agent in it, through the install's rows: it takes them all under one new
 * fence, renews them every {@link LeaseTimes.renewEveryMs}, and ends with a clean stop. Every time
 * comes from the database's clock, never the worker's.
 *
 * Each Postgres store host of the install carries the held lease, and every write it runs first
 * checks it in its own transaction. A write whose lease another worker took, that expired, or that
 * names no lease at all fails `store.lease_lost` and changes nothing; it is never retried. On
 * `store.lease_lost`, or a renewal answered `lost`, the worker stops the install's engine and
 * runtime at once and writes nothing more: another worker may hold it already. SQLite has no
 * lease: the engine lock holds its state folder.
 */
export interface AgentLeases {
  /**
   * Takes every row of the install in one transaction, each at its fence plus one, once every row
   * has expired; `held` while one has not, or while a write of the holder keeps the rows locked
   * past the lock timeout, and `not_found` for an install with no row.
   */
  take(take: LeaseTake, options: LeaseCall): Promise<Result<HeldLease, "held" | "not_found">>;
  /**
   * Moves the expiry of the rows that name the lease's worker and fence {@link LeaseTimes.leaseMs}
   * ahead of the database's now. `lost` when no row names them: another worker took the install.
   */
  renew(lease: HeldLease, options: LeaseCall): Promise<Result<HeldLease, "lost">>;
  /** Sets the expiry of the rows that name the lease's worker and fence to now: a clean stop. */
  stop(lease: HeldLease, options: LeaseCall): Promise<void>;
  /**
   * Adds a new agent's row, a copy of the install's own row under the agent's id, while the lease
   * holds; `lost` otherwise. A row already there answers as added.
   */
  addAgent(lease: HeldLease, agentId: Id<"agt">, options: LeaseCall): Promise<Result<void, "lost">>;
  /** Deletes a deleted agent's row while the lease holds, else `lost`; no row answers as done. */
  removeAgent(
    lease: HeldLease,
    agentId: Id<"agt">,
    options: LeaseCall,
  ): Promise<Result<void, "lost">>;
}
