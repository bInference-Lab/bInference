import type { Logger } from "@binference/core";
import { type Client, DatabaseError } from "pg";
import type { CommitCall, CommitIdentity, CommitReading, CommitStatus } from "./commit-step.js";

interface StatusRow {
  readonly server_start: string;
  readonly status: "committed" | "aborted" | "in progress" | null;
  readonly is_alive: boolean;
}

// The server's start first: a transaction id names a transaction of one server's run only, so
// another start (a restart, a failover) can tell nothing. On the same run the status and whether
// the write's own session, by process id and session start, still runs.
const statusQuery = `
select pg_postmaster_start_time()::text as server_start,
  case when pg_postmaster_start_time()::text = $1 then pg_xact_status($2::xid8) end as status,
  exists (
    select from pg_stat_activity where pid = $3 and backend_start::text = $4
  ) as is_alive`;

// Only while the session still runs the write's own transaction: once its COMMIT answered, the
// session may serve another call, which an end must never reach.
const endQuery = `
select pg_terminate_backend(pid, 2000) as ended from pg_stat_activity
  where pid = $1 and backend_start::text = $2 and backend_xid = ($3::xid8)::xid`;

function errorCodeOf(error: Error["cause"]): string {
  return error instanceof DatabaseError ? (error.code ?? "") : "";
}

function ignore(): void {
  // The call's own promise carries the failure.
}

// Runs `work` on a client of its own, cut once `call`'s time passed or its signal aborted: a
// network that stops answering never holds the check past its bound.
async function withClient<Output>(
  open: () => Client,
  call: CommitCall,
  work: (client: Client) => Promise<Output>,
): Promise<Output> {
  const deadline = AbortSignal.any([AbortSignal.timeout(call.timeoutMs), call.signal]);
  deadline.throwIfAborted();
  const client = open();
  const cut = (): void => {
    client.connection.stream.destroy();
  };
  // A cut or a lost connection fails the query; the client also emits it, and nothing else hears.
  client.on("error", ignore);
  deadline.addEventListener("abort", cut, { once: true });
  try {
    await client.connect();
    return await work(client);
  } finally {
    deadline.removeEventListener("abort", cut);
    void client.end().catch(ignore);
  }
}

function readingOf(row: StatusRow | undefined, identity: CommitIdentity): CommitReading {
  if (row === undefined) {
    return { kind: "unreachable" };
  }
  if (row.server_start !== identity.serverStart) {
    return { kind: "other_server" };
  }
  return { kind: "status", status: row.status ?? undefined, isAlive: row.is_alive };
}

/**
 * The {@link CommitStatus} over `pg` (decision 0438): each ask and each end opens a connection of
 * its own with the pool's settings, as a read's cancel does, so a pool whose connections broke
 * still asks, and cuts it once the time its call was given has passed. A connection or a query
 * that fails or is cut reads as `unreachable` and is logged; an end that fails is logged and the
 * next ask finds the session.
 */
export function createCommitStatus(open: () => Client, logger: Logger): CommitStatus {
  // A call the check stopped, since COMMIT answered, failed for no fault worth a log line.
  const failed = (error: Error["cause"], call: CommitCall): void => {
    if (!call.signal.aborted) {
      logger.warn("store.commit_check_failed", { errorCode: errorCodeOf(error) });
    }
  };
  return {
    async ask(identity, call) {
      try {
        const { rows } = await withClient(open, call, async (client) =>
          client.query<StatusRow>(statusQuery, [
            identity.serverStart,
            identity.transactionId ?? null,
            identity.processId,
            identity.sessionStart,
          ]),
        );
        return readingOf(rows[0], identity);
      } catch (error) {
        failed(error, call);
        return { kind: "unreachable" };
      }
    },
    async end(identity, call) {
      try {
        const { rows } = await withClient(open, call, async (client) =>
          client.query<{ readonly ended: boolean }>(endQuery, [
            identity.processId,
            identity.sessionStart,
            identity.transactionId ?? null,
          ]),
        );
        if (rows.some(({ ended }) => ended)) {
          logger.warn("store.commit_session_ended");
        }
      } catch (error) {
        failed(error, call);
      }
    },
  };
}
