# 0438. A Postgres write whose commit answer was lost asks the database how it ended

Status: Accepted

Accepted by the tech lead on 2026-11-13. Amends
[decision 0413](0413-postgres-writes-rerun-once-on-a-unique-violation-and-money-writes-answer-their-own-replay.md):
its callers no longer replay a write after `store.commit_unknown`. It also changes a bullet of
[decision 0365](0365-the-postgres-store-runs-on-node-postgres-through-kysely-s-built-in-dialect.md),
"an abort or a lost connection during `COMMIT` is a fault, `store.commit_unknown`, never retried",
and a line of
[decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md),
"a connection lost or aborted while `COMMIT` is in flight fails `store.commit_unknown` and is never
retried; the caller rereads before it decides again": such a write first asks the database how it
ended, and fails `store.commit_unknown` only when the database cannot tell. It also amends
[decision 0436](0436-a-lost-lease-stops-the-run-where-it-stands-and-writes-nothing-after-it.md):
`store.commit_unknown` joins the lost lease's codes, which the money code's catches let through
untouched.

## Context

A Postgres write fails `store.commit_unknown` in one place, `postgresWrite`
(`packages/store/src/postgres/postgres-transaction.ts`): when its connection is lost while `COMMIT`
is in flight, or its signal aborts while `COMMIT` runs, the signal being the caller's, the engine's
stop or the store call's 30-second bound. The task thread never sees `COMMIT`: it runs on the
statement side
([decision 0369](0369-store-tasks-stay-synchronous-on-postgres-over-a-task-thread.md)). Every write
can meet it: the 144 write tasks of both databases' stores, the lease port's takes and renewals,
and the migrations.

Decision 0413 made four money writes answer their own replay as their first run did (`saveSigned`,
`ledger.append`, `positions.record`, `recordLandedFill`), kept `exists` and `stale` for
`intents.create` and `transition`, and left the replay to the Cloud worker's callers. Nothing calls
it yet. Their engine callers are the wallet slot (`saveSigned`, `saveReplacement`), a step's send
(`recordSend`, `ledger.append`), the reconciliation (`positions.record`), the positions of
arrivals and departures, a fill counted late (`recordLandedFill`), the stored intents (`create`,
`transition`) and a freeze. Most other writes do not answer their own replay: a config journal
entry takes its number from `counters` and would be stored twice, and others answer `exists`,
`stale`, a repeat or `store.constraint` where their first run answered something else. A caller
replay also needs the same database the store could ask itself.

Postgres keeps the commit status of each recent transaction: `pg_xact_status(xid8)` answers
`committed`, `aborted` or `in progress`, and its manual ("System Information Functions") names this
use, a client that lost its connection while `COMMIT` was in progress. A transaction's id is read
inside it with `pg_current_xact_id_if_assigned()`, which is empty for a transaction that wrote
nothing. A session whose `COMMIT` never arrived is idle in a transaction, and the store's
`idle_in_transaction_session_timeout` of 2 seconds ends it
([decision 0365](0365-the-postgres-store-runs-on-node-postgres-through-kysely-s-built-in-dialect.md)).
`pg_terminate_backend(pid, timeout)` ends a session of the caller's own role and waits for it.
After a failover to a replica that never received a commit, the new primary can hand that
transaction's id to another transaction.

## Decision

- **Each write reads its identity before `COMMIT`.** After the task's last statement, in the
  write's own transaction, the statement side reads the transaction's id if it has one, its
  session's process id and start time, and the server's start time
  (`pg_postmaster_start_time()`). The task never sees them.
- **A lost answer is asked for.** When `COMMIT`'s answer is lost, the write asks the database how
  its transaction ended, on a connection of its own as a cancel opens one, every 100 ms, within
  10 seconds of its own whatever the caller's signal. An abort while `COMMIT` runs first waits for
  `COMMIT`'s own answer within the same bound.
  - **Bounded on the client too.** Each ask and each session end gets only what is left of the 10
    seconds, and its connection is cut once that has passed, so a path that stops answering never
    holds the check; the connection keeps TCP keepalive on. No ask starts once the 10 seconds
    passed.
  - **`COMMIT`'s own answer.** After an abort while `COMMIT` runs, `COMMIT`'s answer and the
    database's race, and the first that tells decides: `COMMIT` answering ends the check where it
    stands, and a `COMMIT` that lost its connection tells nothing. The write keeps its connection
    out of the pool until both `COMMIT` and the check ended, so no other call takes a session the
    check may end.
  - **Committed:** the write answers what its task gave.
  - **Aborted, or no transaction id:** nothing landed. The write runs again from its first read,
    as a conflict does, after the same waits and within the three of
    [decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md);
    the rerun checks the lease fence again.
  - **In progress:** it asks again. After 3 seconds, past the session's own idle timeout, it ends
    the session with `pg_terminate_backend`, only while the same process id has the same session
    start and still runs the write's own transaction (`backend_xid`), waits up to 2 seconds, and
    asks again.
  - **Another server start, an id the server no longer keeps, or no connection:** the write cannot
    tell, and fails `store.commit_unknown` with the transaction id in its details.
- **A host that cannot tell writes nothing more.** After `store.commit_unknown`, a store host
  refuses every later write of its schema with the same code, before the database, the writes
  already queued behind the one that failed too, and tells its owner once through
  `onCommitUnknown`, which every host with a lease must take. Its reads go on. The owner stops the
  install's engine and runtime at once, as on a lost lease, and the next start's recovery reads the
  rows, as after a kill. The money code's catches let the code through as they let a lost lease
  through (decision 0436), so a run stops where it stands and writes nothing after it. The lease
  port's writes and the migrations are not bound to a host and answer the code to their caller.
- **No caller replays.** No engine code replays a write or decides on `store.commit_unknown`. A
  caller that maps a fault to an outcome, such as a fill's `fill_failed` skip, writes nothing, since
  the host refuses the write. The own-replay answers of decision 0413 stay, so a write sent twice
  still adds nothing, but nothing relies on a replay.
- **Self-hosted** is unchanged: SQLite never fails a commit unknown. A commit lands, or the process
  dies with it and the start's recovery reads the rows.

## Consequences

- A write whose connection drops at `COMMIT` answers as an uncut write would, in almost every case.
  `store.commit_unknown` reaches a caller only when the database cannot be asked within 10 seconds,
  or after a failover, and then the install stops and recovers as after a crash, the path the crash
  suite proves.
- Every Postgres write reads one more statement before `COMMIT`, one round trip and a look at its
  own session in `pg_stat_activity`. Measured on the test server in Docker on a Mac, 1,000 writes
  of one insert each: 0.53 ms without it and 0.82 to 0.88 ms with it, the read alone 0.30 to
  0.34 ms beside a 0.175 ms round trip; with 100 more sessions open, 0.95 to 1.02 ms with it and the
  read alone 0.38 ms. The same read through `pg_stat_get_activity(pg_backend_pid())` costs 0.21 ms,
  0.23 ms with the 100 sessions.
- The database roles of spec 3, section 6.6 grant the worker role `pg_current_xact_id_if_assigned`,
  `pg_xact_status`, `pg_postmaster_start_time`, and `pg_terminate_backend` on its own role's
  sessions.
- `commitUnknown`'s message no longer tells the caller to read and decide: the host writes nothing
  more, and the install stops.
- The Cloud worker passes `onCommitUnknown` and stops the install on it; that part lives with the
  worker, outside this repository.
- A write stuck in `COMMIT` past 3 seconds, as one that waits for a synchronous standby, is ended
  and reads committed; whether the standby holds it is the database service's.

## Alternatives

- **Callers replay the same write, decision 0413's plan.** A replay needs the database as a status
  read does, and only the money writes answer their own replay: each other write task would need
  its own rule for a second run, kept per caller. `retry` of `@binference/core` retries only a
  retryable fault, so it would need a predicate, three tries within 10 seconds, and a write whose
  replay still cannot tell would stop the install as here.
- **Stop the install on every `store.commit_unknown`.** No status read, but a pooler restart that
  drops many connections at once would restart every install it carried.
- **A row per committed write.** A token each write inserts, read back to tell: certain after a
  failover too, but an insert per write, a prune job and a table in both schemas of every install.
  The status read falls back to the crash path after a failover instead.
- **Wait for the old session to end, then read the rows.** Each task would need its own read of
  what it wrote: the per-caller rule above, in the store.
