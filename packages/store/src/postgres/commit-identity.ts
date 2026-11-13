import { sql } from "kysely";
import type { CommitIdentity } from "./commit-step.js";
import type { PostgresConnection } from "./postgres-connection.js";

interface IdentityRow {
  readonly transaction_id: string | null;
  readonly process_id: number;
  readonly session_start: string;
  readonly server_start: string;
}

// A transaction that wrote nothing has no id, and its COMMIT changes nothing either way.
const identityQuery = sql<IdentityRow>`
select pg_current_xact_id_if_assigned()::text as transaction_id,
  pg_backend_pid() as process_id,
  (select backend_start::text from pg_stat_activity where pid = pg_backend_pid()) as session_start,
  pg_postmaster_start_time()::text as server_start`;

/**
 * Reads, in a write's own transaction after its task's last statement, what the write needs to
 * ask how the transaction ended should `COMMIT`'s answer be lost (decision 0438).
 */
export async function readCommitIdentity<Schema>(
  connection: PostgresConnection<Schema>,
): Promise<CommitIdentity> {
  const row = await connection.takeFirst(identityQuery.compile(connection.kysely));
  const transactionId = row?.transaction_id ?? undefined;
  return {
    ...(transactionId === undefined ? {} : { transactionId }),
    processId: row?.process_id ?? 0,
    sessionStart: row?.session_start ?? "",
    serverStart: row?.server_start ?? "",
  };
}
