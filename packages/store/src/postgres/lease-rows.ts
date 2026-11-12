import { BinferenceError, type Id } from "@binference/core";
import { sql } from "kysely";
import { z } from "zod";
import type { LeaseRow } from "../leases/agent-leases.js";
import type { PostgresConnection } from "./postgres-connection.js";

/** Where an install's lease rows live: the shared schema, and the install. */
export interface LeaseRowsAt {
  readonly sharedSchema: string;
  readonly installId: Id<"ins">;
}

const epochMs = z.number().int().nonnegative();

// A row as Postgres answers it, renamed as it is parsed.
const leaseRowSchema: z.ZodType<LeaseRow> = z
  .strictObject({
    agent_id: z.string(),
    worker_id: z.string().nullable(),
    fence: z.number().int().positive(),
    taken_at: epochMs.nullable(),
    renewed_at: epochMs.nullable(),
    expires_at: epochMs,
  })
  .transform((row) => ({
    agentId: row.agent_id,
    workerId: row.worker_id,
    fence: row.fence,
    takenAtMs: row.taken_at,
    renewedAtMs: row.renewed_at,
    expiresAtMs: row.expires_at,
  }));

const clockSchema = z.strictObject({ now_ms: epochMs });

const clockQuery = sql`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as now_ms`;

function badReply(what: string, cause: Error["cause"]): BinferenceError {
  return new BinferenceError({
    code: "store.bad_reply",
    message: `Postgres answered ${what} in a shape the lease check does not read.`,
    cause,
    details: { what },
  });
}

/** The database's clock, `clock_timestamp()`, in whole epoch milliseconds. */
export async function databaseNowMs<Schema>(
  connection: PostgresConnection<Schema>,
): Promise<number> {
  const row = await connection.takeFirst(clockQuery.compile(connection.kysely));
  const parsed = clockSchema.safeParse(row);
  if (!parsed.success) {
    throw badReply("clock_timestamp", parsed.error);
  }
  return parsed.data.now_ms;
}

/**
 * Locks every lease row of an install, `FOR SHARE` for a write that checks it or `FOR UPDATE` for
 * a take, and only then reads the database's clock, so a lock's wait never ages the time it is
 * judged at. The rows come in agent id order, the install's own first.
 */
export async function lockLeaseRows<Schema>(
  connection: PostgresConnection<Schema>,
  at: LeaseRowsAt,
  lock: "share" | "update",
): Promise<{ readonly rows: readonly LeaseRow[]; readonly nowMs: number }> {
  const table = sql.id(at.sharedSchema, "agent_leases");
  const select = sql`select agent_id, worker_id, fence, taken_at, renewed_at, expires_at
    from ${table} where install_id = ${at.installId} order by agent_id`;
  const query = lock === "share" ? sql`${select} for share` : sql`${select} for update`;
  const { rows } = await connection.execute(query.compile(connection.kysely));
  const parsed = z.array(leaseRowSchema).safeParse(rows);
  if (!parsed.success) {
    throw badReply("agent_leases", parsed.error);
  }
  return { rows: parsed.data, nowMs: await databaseNowMs(connection) };
}
