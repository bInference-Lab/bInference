# 0365. The Postgres store runs on node-postgres through Kysely's built-in dialect

Status: Accepted

Accepted by the owner on 2026-11-05.

## Context

The Postgres store adapter passes the same store contract suites as SQLite
([decision 0031](../DECISIONS.md#d0031), [ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)).
Its queries go through Kysely, which the repo pins at 0.29.6. Kysely needs a dialect and a driver
for Postgres. An adapter for an outside service starts from the official docs and uses an
official package that fits, at its latest release at least 7 days old
([ENGINEERING.md section 17](../ENGINEERING.md#section-17)). Every async call takes an
`AbortSignal` and has a timeout (root `AGENTS.md`). The workers run Node 26, ESM only.

Kysely's "Dialects" page lists, for Postgres:

- `PostgresDialect`, built into Kysely. Kysely's "Getting started" page says it uses the `pg`
  driver (node-postgres). Kysely 0.29.6 tests itself against `pg` 8.23.0.
- `PGliteDialect`, built in since Kysely 0.29.0: Postgres compiled to WebAssembly inside the Node
  process, with no server.
- `kysely-postgres-js`, from the Kysely organization, on postgres.js (`postgres`) or Bun's SQL.
- `kysely-neon`, a community dialect on Neon's serverless driver.

What the official docs and the npm registry say on 2026-11-05:

| Point               | `pg` 8.23.1 with `PostgresDialect`                                                                                                                                                                                                                                                                        | `postgres` 3.4.9 with `kysely-postgres-js` 5.0.1                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Release             | 2026-09-30, the latest; 10 releases in a year                                                                                                                                                                                                                                                             | 3.4.9 is 2026-04-05. 4.0.0 came out 2026-10-29, inside the 7-day wait, and outside the dialect's peer range `postgres ^3.4.0`                |
| Dialect             | Built into Kysely, tested by Kysely's own suite                                                                                                                                                                                                                                                           | A separate package; an open issue (#468) reports server memory that grows while every query is prepared, worked around with `prepare: false` |
| Node 26 and ESM     | The changelog adds Node 26 support in 8.21.0, and its CI runs Node 26. An ESM entry since 8.15.0, over the CommonJS build                                                                                                                                                                                 | ESM and CommonJS builds; Node 26 is not named in its docs                                                                                    |
| Cancellation        | Kysely 0.29 takes a `signal` on every query and transaction, and with `inflightQueryAbortStrategy` sends `pg_cancel_backend` over a control connection. Server timeouts: `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`; client `query_timeout` and `connectionTimeoutMillis` | 3.4.9 has `query.cancel()`, which its README says may not cancel. An `AbortSignal` comes only with 4.0.0                                     |
| TLS                 | The `ssl` option goes to Node's `tls.connect`. The `pg-connection-string` README warns that `sslmode` values in a URL change meaning in `pg` 9                                                                                                                                                            | `ssl` with modes or `tls.connect` options                                                                                                    |
| Pool                | Built in: `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `maxLifetimeSeconds`; the "Pool" page asks for an `error` listener                                                                                                                                                                       | Built in: `max`, `idle_timeout`, `connect_timeout`, `max_lifetime`                                                                           |
| Prepared statements | Named only when a query names itself; Kysely names none, so each statement is an unnamed extended-protocol statement                                                                                                                                                                                      | Every query prepared by default                                                                                                              |
| Types               | "Types" page: `int8` and `numeric` come back as strings unless a parser is set; `json` and `jsonb` are parsed                                                                                                                                                                                             | `int8` and `numeric` as strings unless a parser is set                                                                                       |
| Dependencies        | 13 pure JavaScript packages, MIT, no install script; `pg-native` is an optional peer we never install                                                                                                                                                                                                     | No dependencies; Unlicense                                                                                                                   |

## Decision

- The Postgres store uses Kysely's built-in `PostgresDialect` on `pg` 8.23.1, with the `Pool` from
  `pg`. Kysely stays at 0.29.6. `pg-native` and `pg-cursor` are not installed: no store task
  streams rows.
- Postgres 17 or later. The adapter refuses an older server at open with the version it found.
- TLS: the adapter passes an explicit `ssl` object, `rejectUnauthorized: true` with the provider's
  CA, never `sslmode` in a connection string. A connection that is not TLS is refused, except to
  `127.0.0.1`, `::1` or a Unix socket, for tests.
- Every session sets, on connect: `statement_timeout` 5 s, `lock_timeout` 2 s,
  `idle_in_transaction_session_timeout` 2 s, `TimeZone` UTC, an empty `search_path` (every query
  names its schema) and `application_name` naming the service. The pool sets
  `connectionTimeoutMillis` 5,000, `idleTimeoutMillis` 10,000 and `maxLifetimeSeconds` 1,800, and
  logs each pool `error` event as a fault. These are starting values the first load test tunes.
- Every store call passes its `AbortSignal` to Kysely. A read uses the `'cancel query'` strategy. A
  write transaction uses `'ignore query'`: its abort before `COMMIT` rolls it back, and an abort or a
  lost connection during `COMMIT` is a fault, `store.commit_unknown`, never retried
  ([decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md)).
- The workers connect to Postgres directly or through a session-mode pooler, never a
  transaction-mode one, so a cancel reaches the backend that runs the query.
- The adapter sets every type parser it relies on, and a contract case pins each: `int8` to a
  JavaScript number, refusing a value past `Number.MAX_SAFE_INTEGER` with a fault; `numeric` to its
  decimal text as the server writes it; `int2` and `int4` to numbers. No column is `json`, `jsonb`,
  `timestamp` or `date` ([decision 0367](0367-each-install-keeps-its-own-pair-of-postgres-schemas-with-sqlite-s-row-shapes.md)),
  so no other parser is needed.
- The dependency enters through the catalog at an exact version, under the 7-day rule
  (`check:deps-policy`); `allowBuilds` does not change.

## Consequences

- The dialect, the cancel path and the transaction builder (`setIsolationLevel`,
  `setAccessMode`) are Kysely's own, tested by Kysely against this driver.
- The store keeps Kysely's query builder for both dialects; only the dialect and the row parsers
  differ.
- A Postgres outage or a slow statement fails a store call within its timeout, with a fault the
  engine already fails closed on.
- An abort during `COMMIT` leaves the outcome unknown; the caller rereads before it decides again,
  as after a restart.
- A move to `pg` 9 is its own change: its `sslmode` meanings and parsers change, and this decision
  pins neither by a URL.

## Alternatives

- **postgres.js with `kysely-postgres-js`.** No dependencies and a cleaner cancel API, but the
  version with an `AbortSignal` (4.0.0) is inside the 7-day wait and outside the dialect's peer
  range, 3.4.9 cannot promise a cancel, and the dialect is a separate package with an open memory
  issue on prepared statements. It is the runner-up; a later release of both can be weighed again.
- **PGlite.** Postgres inside the Node process, with no server and no network; it cannot serve
  workers on several hosts. Tests run on a real Postgres service, so the adapter meets the server
  it runs against.
- **Neon's serverless driver, `@vercel/postgres`, Bun's SQL.** Built for serverless functions or
  another runtime; the workers are long-lived Node processes, and `@vercel/postgres` is deprecated on
  npm.
- **`pg-native`.** Compiles `libpq` at install, which the repo keeps off.
