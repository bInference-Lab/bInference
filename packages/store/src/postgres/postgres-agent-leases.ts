import { BinferenceError, err, type Id, ok, type Result } from "@binference/core";
import { sql } from "kysely";
import {
  type AgentLeases,
  type HeldLease,
  holdsLease,
  type LeaseRow,
  type LeaseTake,
  leaseTimes,
} from "../leases/agent-leases.js";
import { databaseNowMs, lockLeaseRows } from "./lease-rows.js";
import type { PostgresDatabase } from "./open-postgres.js";
import type { PostgresConnection } from "./postgres-connection.js";
import { sqlStateOf } from "./postgres-error.js";

/** What {@link createPostgresAgentLeases} works on. */
export interface PostgresAgentLeasesOptions<Schema> {
  /** The pool its transactions run on. */
  readonly database: PostgresDatabase<Schema>;
  /** The shared schema that holds `agent_leases`. */
  readonly sharedSchema: string;
  /** How far ahead a take or renewal moves the expiry; {@link leaseTimes} by default. */
  readonly leaseMs?: number;
}

interface Leases<Schema> {
  readonly database: PostgresDatabase<Schema>;
  readonly sharedSchema: string;
  readonly leaseMs: number;
}

/** What an agent row's change works on, inside a write whose lease holds. */
interface AgentRowChange {
  readonly lease: HeldLease;
  readonly agentId: Id<"agt">;
  /** Every row of the install, locked `FOR SHARE`. */
  readonly rows: readonly LeaseRow[];
}

type RowChange<Schema> = (
  leases: Leases<Schema>,
  connection: PostgresConnection<Schema>,
  change: AgentRowChange,
) => Promise<void>;

// SQLSTATE 55P03: a row lock waited past `lock_timeout`, which a write in flight holds.
function isLockTimeout(error: Error["cause"]): boolean {
  return error instanceof BinferenceError && sqlStateOf(error.cause) === "55P03";
}

function tableOf<Schema>(leases: Leases<Schema>): ReturnType<typeof sql.id> {
  return sql.id(leases.sharedSchema, "agent_leases");
}

async function takeRows<Schema>(
  leases: Leases<Schema>,
  connection: PostgresConnection<Schema>,
  take: LeaseTake,
): Promise<Result<HeldLease, "held" | "not_found">> {
  const at = { sharedSchema: leases.sharedSchema, installId: take.installId };
  const { rows, nowMs } = await lockLeaseRows(connection, at, "update");
  const own = rows.find((row) => row.agentId === "") ?? rows[0];
  if (own === undefined) {
    return err("not_found");
  }
  if (rows.some((row) => row.expiresAtMs > nowMs)) {
    return err("held");
  }
  const expiresAtMs = nowMs + leases.leaseMs;
  await connection.execute(
    sql`update ${tableOf(leases)} set worker_id = ${take.workerId}, fence = fence + 1,
        taken_at = ${nowMs}, renewed_at = ${nowMs}, expires_at = ${expiresAtMs}
      where install_id = ${take.installId}`.compile(connection.kysely),
  );
  return ok({ ...take, fence: own.fence + 1, takenAtMs: nowMs, expiresAtMs });
}

// Locks the rows a lease's worker and fence name, then sets their expiry `aheadMs` past the
// database's now: `leaseMs` for a renewal, which also stamps `renewed_at`, and 0 for a stop.
async function moveExpiry<Schema>(
  leases: Leases<Schema>,
  connection: PostgresConnection<Schema>,
  move: { readonly lease: HeldLease; readonly aheadMs: number },
): Promise<{ readonly moved: number; readonly expiresAtMs: number }> {
  const { lease, aheadMs } = move;
  const table = tableOf(leases);
  const named = sql`install_id = ${lease.installId} and worker_id = ${lease.workerId}
    and fence = ${lease.fence}`;
  const locked = await connection.execute(
    sql`select agent_id from ${table} where ${named} for update`.compile(connection.kysely),
  );
  const nowMs = await databaseNowMs(connection);
  const expiresAtMs = nowMs + aheadMs;
  const renewed = aheadMs > 0 ? sql`, renewed_at = ${nowMs}` : sql``;
  await connection.execute(
    sql`update ${table} set expires_at = ${expiresAtMs}${renewed} where ${named}`.compile(
      connection.kysely,
    ),
  );
  return { moved: locked.rows.length, expiresAtMs };
}

// A new agent's row copies the install's own; a row already there stays as it is.
async function insertAgent<Schema>(
  leases: Leases<Schema>,
  connection: PostgresConnection<Schema>,
  { lease, agentId, rows }: AgentRowChange,
): Promise<void> {
  const own = rows.find((row) => row.agentId === "") ?? rows[0];
  if (own === undefined || rows.some((row) => row.agentId === agentId)) {
    return;
  }
  await connection.execute(
    sql`insert into ${tableOf(leases)}
        (install_id, agent_id, worker_id, fence, taken_at, renewed_at, expires_at)
      values (${lease.installId}, ${agentId}, ${own.workerId}, ${own.fence}, ${own.takenAtMs},
        ${own.renewedAtMs}, ${own.expiresAtMs})`.compile(connection.kysely),
  );
}

async function deleteAgent<Schema>(
  leases: Leases<Schema>,
  connection: PostgresConnection<Schema>,
  { lease, agentId }: AgentRowChange,
): Promise<void> {
  await connection.execute(
    sql`delete from ${tableOf(leases)}
      where install_id = ${lease.installId} and agent_id = ${agentId}`.compile(connection.kysely),
  );
}

// A change of the install's agent rows runs in a write that first checks the lease, as each write
// of a store host does, and changes nothing for a lease that does not hold.
function whileHeld<Schema>(
  leases: Leases<Schema>,
  change: RowChange<Schema>,
): AgentLeases["addAgent"] {
  return async (lease, agentId, { signal }) =>
    leases.database.write<Result<void, "lost">>(async (connection) => {
      const at = { sharedSchema: leases.sharedSchema, installId: lease.installId };
      const { rows, nowMs } = await lockLeaseRows(connection, at, "share");
      if (!holdsLease(rows, lease, nowMs)) {
        return err("lost");
      }
      await change(leases, connection, { lease, agentId, rows });
      return ok(undefined);
    }, signal);
}

/**
 * The Postgres {@link AgentLeases} on the shared schema's `agent_leases` (spec 3, section 6.5,
 * decision 0418). Each call is one `SERIALIZABLE` write, retried on a conflict, and every time it
 * sets or judges is the database's `clock_timestamp()`, read after the rows are locked.
 */
export function createPostgresAgentLeases<Schema>(
  options: PostgresAgentLeasesOptions<Schema>,
): AgentLeases {
  const leases: Leases<Schema> = { ...options, leaseMs: options.leaseMs ?? leaseTimes.leaseMs };
  const { database } = leases;
  return {
    take: async (take, { signal }) => {
      try {
        return await database.write(
          async (connection) => takeRows(leases, connection, take),
          signal,
        );
      } catch (error) {
        if (isLockTimeout(error)) {
          return err("held");
        }
        throw error;
      }
    },
    renew: async (lease, { signal }) =>
      database.write<Result<HeldLease, "lost">>(async (connection) => {
        const move = { lease, aheadMs: leases.leaseMs };
        const { moved, expiresAtMs } = await moveExpiry(leases, connection, move);
        return moved === 0 ? err("lost") : ok({ ...lease, expiresAtMs });
      }, signal),
    stop: async (lease, { signal }) => {
      await database.write(
        async (connection) => moveExpiry(leases, connection, { lease, aheadMs: 0 }),
        signal,
      );
    },
    addAgent: whileHeld(leases, insertAgent),
    removeAgent: whileHeld(leases, deleteAgent),
  };
}
