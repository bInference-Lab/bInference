# 0368. Postgres reads cancel by server process id

Status: Accepted

Accepted by the tech lead on 2026-11-05.

## Context

[Decision 0365](0365-the-postgres-store-runs-on-node-postgres-through-kysely-s-built-in-dialect.md)
has a Postgres read pass its `AbortSignal` to Kysely with the `'cancel query'` strategy, so an
abort ends the read's statement on the server. Every store read runs inside a `REPEATABLE READ`,
read-only transaction
([decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md)).

Kysely 0.29.6 with `pg` 8.23.1 does not cancel a statement inside a transaction:

- On an abort, Kysely's query executor rejects the query at once and starts the cancel in the
  background: a new `pg` client that, once connected, sends `pg_cancel_backend` only if the
  connection still runs the query it was asked to cancel, compared by query id.
- The rejection ends the transaction's callback, and the transaction builder sends `ROLLBACK` on
  the same connection at once. That records the rollback as the connection's running query before
  the cancel's client has connected, so the cancel finds another query id and sends nothing.
- Measured on Postgres 17.11: `select pg_sleep(30)` inside a `REPEATABLE READ` transaction,
  aborted after 300 ms, ran until `statement_timeout` ended it at 5,010 ms. The same query outside
  a transaction, aborted after 300 ms, was cancelled at 301 ms.

A cancel by process id has a hazard of its own. If the read's connection goes back to the pool
before the cancel arrives, the next call that takes the connection can receive it, and its
statement fails with SQLSTATE `57014`.

## Decision

- A read's first statement reads `pg_backend_pid()`. On an abort, the store opens one new
  connection with the pool's settings (the same TLS, timeouts and role) and runs
  `pg_cancel_backend` on that process id. Kysely's own strategy is `'ignore query'` for reads
  and writes.
- The read keeps its connection until the cancel has ended: the transaction's callback waits for
  the cancel before it ends, so the `ROLLBACK`, and the connection's release to the pool, come only
  after the cancel. A cancel that reaches the connection while it sits idle in its transaction
  changes nothing.
- **Bound.** The cancel's connect ends within `connectionTimeoutMillis` (5 s) and its statement
  within `statement_timeout` (5 s); its close is not waited for. A cancel that lands ends the read
  within a few milliseconds; at worst the aborted read settles within the cancel's 10 s, and its
  own statement never runs past `statement_timeout`.
- **When the cancel fails.** A cancel that cannot connect or whose statement fails is logged as
  `store.postgres_cancel_failed` with its SQLSTATE, if any, and is never retried. The read's
  statement runs on until it ends or `statement_timeout` ends it; the read then rejects with the
  signal's reason, its transaction rolls back, and the connection returns to the pool unharmed. A
  read changes nothing, so no outcome is in doubt.
- Writes keep 0365's rule: an abort stops the wait, the running statement finishes within its
  timeouts, and the transaction rolls back, or fails `store.commit_unknown` during `COMMIT`.

## Consequences

- An aborted read stops using the server within milliseconds instead of holding a connection for
  up to 5 s.
- Each read costs one round trip more, for `pg_backend_pid()`.
- An abort opens one short-lived connection, so the database must leave room for one connection
  beyond the pools; the workers' pool sizes count it.
- The workers still connect directly or through a session-mode pooler, as 0365 requires: a process
  id names a backend only on a direct or session-mode connection.
- A later Kysely release that cancels inside a transaction can replace this; the cancel test on
  Postgres shows whether it does.

## Alternatives

- **Kysely's `'cancel query'` alone.** It sends nothing inside a transaction, as measured above.
- **`'kill session'`.** Kysely's kill takes the same path and misses for the same reason; a kill
  that landed would also drop the connection.
- **Cancel without holding the connection.** The cancel could reach the next call's statement and
  fail it with `57014`; a test shows it does.
- **Rely on `statement_timeout` only.** Correct, but an aborted read holds its connection for up to
  5 s, and a busy pool waits for it.
