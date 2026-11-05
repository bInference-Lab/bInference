# 0369. Store tasks stay synchronous on Postgres over a task thread

Status: Accepted

Accepted by the tech lead on 2026-11-05.

## Context

A store task's `run` is synchronous: it rereads the rows it decides on and writes them in one
transaction, with no `await` inside ([ENGINEERING.md section 10](../ENGINEERING.md#section-10),
`packages/store/AGENTS.md`). 217 tasks in 57 files run their queries through `createSyncKysely`
on a `node:sqlite` connection, which answers each statement before it returns.

The Postgres store passes the same contract suites with the same task code, row types and schemas
([decision 0367](0367-each-install-keeps-its-own-pair-of-postgres-schemas-with-sqlite-s-row-shapes.md)).
Its driver, `pg` through Kysely's `PostgresDialect`, is asynchronous only
([decision 0365](0365-the-postgres-store-runs-on-node-postgres-through-kysely-s-built-in-dialect.md)).
`postgresWrite` and `postgresRead` already hold a transaction on one pooled connection, run it at
the isolation of [decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md),
retry a conflict, report a lost `COMMIT` as `store.commit_unknown`, and cancel an aborted read by
process id ([decision 0368](0368-postgres-reads-cancel-by-server-process-id.md)). A store session
caps each statement: `statement_timeout` 5 s, `lock_timeout` 2 s,
`idle_in_transaction_session_timeout` 2 s.

Node's `Atomics.wait` blocks a worker thread on a shared word until another thread notifies it or
a time-out passes, and `receiveMessageOnPort` reads a message from a port synchronously. Measured
on Node 26.10: one round trip between two threads this way takes about 9 µs.

## Decision

- **Tasks stay synchronous.** On Postgres a task runs on a task thread: the database's store
  worker entry, started with a Postgres task setup. Its connection is a `PostgresTaskConnection`
  with the install's schema. Each statement goes to the thread that holds the transaction (the
  statement side), which runs it on the transaction's connection inside `postgresWrite` or
  `postgresRead`; the task thread blocks on `Atomics.wait` until the answer comes.
- **One connection type.** Task code takes `StoreConnection`, which is `node:sqlite`'s connection
  or a `PostgresTaskConnection`. `createSyncKysely` picks Kysely's SQLite or Postgres compiler from
  it; on Postgres, `withSchema` names the install's schema on every table a query reads or writes,
  since a store session's `search_path` is empty. Bound values pass the same check on both.
- **Payloads cross by message.** Statements, rows and the task's output cross by structured clone
  on the thread's port, read with `receiveMessageOnPort`. The shared buffer holds two words only:
  a count of the messages the statement side posted, which wakes the task thread, and the number
  of the run the caller aborted. No buffer bounds a result's size; memory bounds it, as on SQLite.
- **Retry.** A write that meets SQLSTATE `40001` or `40P01` rolls back, and `postgresWrite` runs
  the task's `run` again from its first statement in a new transaction, as 0366 sets. The task
  thread is idle between attempts. The store host runs one schema's writes one at a time, in the
  order the calls came, retries included.
- **Wait bound.** The task thread waits at most `statement_timeout` plus 1 s, 6 s, for one
  statement's answer. Past it the task throws `store.postgres_unreachable`, and the statement side
  aborts the transaction with that fault: a read's statement is cancelled by process id, a
  write's ends within its server timeouts and the transaction rolls back. The task thread never
  waits for `COMMIT`: the task ends with its last statement's answer, and `COMMIT` runs on the
  statement side, where 0366's `store.commit_unknown` applies. Each call also has a time bound,
  30 s by default as on SQLite, which fails it `store.timeout`.
- **Abort.** The caller's signal stays on the statement side. An abort aborts the transaction's
  signal, writes the run's number into the aborted word and wakes the task thread, which throws;
  the task unwinds and the transaction rolls back. A read's running statement is cancelled by
  process id while the read still holds its connection (0368).
- **A failed statement** makes the task thread throw so the task unwinds, as on SQLite. The
  statement side keeps the server's error and reports it, so a broken constraint is
  `store.constraint` on both; later statements of the run are refused without reaching the server.
- **One run at a time.** A task thread runs one task at a time and may serve the schemas of many
  installs of its database. A run settles only once its task ended and none of its statements
  still runs.

## Consequences

- Task bodies do not change; the tasks and the row helpers they call, 59 files, change only the
  type of their connection.
- Measured on Postgres 17.11 in a local container: a write task of three statements took 1.11 ms
  through the bridge against 0.98 ms with the same statements run directly, about 45 µs a
  statement for the crossing, the second compile and the checks.
- A task's own work runs on the task thread and its network I/O on the statement side, so a slow
  install's task delays the other installs its task thread serves; the Cloud worker's count of
  task threads is a load-test setting.
- Postgres reports no insert row id. A task that reads `insertId` reads its new key with
  `returning` in its Postgres port. SQL that only SQLite runs (`json_extract`,
  `json_array_length`, FTS5, `instr`, `INSERT OR IGNORE`, integer casts of block numbers) gets its
  Postgres form before its store's suite passes there.
- An aborted write returns once its running statement ends, at most `statement_timeout` later,
  since a write's statement is not cancelled (0365).

## Alternatives

- **Asynchronous tasks on both databases.** Every task would `await` inside its transaction,
  against ENGINEERING.md section 10. On SQLite an `await` inside `BEGIN IMMEDIATE` holds the one
  write lock across event-loop turns, and other code can run between a task's read and its write.
  All 217 tasks would be rewritten.
- **Separate asynchronous Postgres adapters.** Each store would be written twice, against 0367's
  one task code, row types and schemas, and the money rules would live in two copies to keep in
  step.
- **A synchronous driver.** `pg-native` compiles `libpq` at install, which the repo keeps off
  (0365).
- **Payloads in the shared buffer.** It bounds a result's size and needs an encoding of its own
  for bigints and bytes, which structured clone already carries.
