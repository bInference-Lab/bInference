# 0367. Each install keeps its own pair of Postgres schemas with SQLite's row shapes

Status: Accepted

Accepted by the owner on 2026-11-05.

## Context

Self-hosted, one install is one state folder: `engine.sqlite` and `agent.sqlite`, one engine and
one agent runtime ([spec 3](../specs/database.md), [spec 8](../specs/runtime.md)). Several engine
tables hold one row per install: `safety`, `custody`, `engine_alive` and `telegram_owner` are keyed
`id = 1`; `meta` holds the install id and the schema version; the ledger is one hash chain; the
tracked-wallet cap of 50 and the freeze of the whole install count the install. The agent database
holds one writer fence for the install's runtime.

On Cloud one Postgres serves every user, and each user runs agents on our workers
([ARCHITECTURE.md section 30](../ARCHITECTURE.md#section-30)). The plan keeps the engine and agent
databases as two schemas, adds `agent_leases`, and gives each service its own database role. No
self-hosted behavior may change to fit Cloud.

The store's tasks read and write rows through Kysely, and their row types and zod schemas are the
same code on every adapter. A different row shape on Postgres, such as a `boolean` where SQLite
holds `0` or `1`, or a parsed object where SQLite holds JSON text, would split that code by dialect.

## Decision

- **One install, two schemas.** Each Cloud user's install keeps its engine tables in schema
  `engine_<install>` and its agent tables in `agent_<install>`, where `<install>` is the 32
  lowercase hex digits of its install id. Each schema holds every table of its SQLite database, by
  the same names, with its own `meta` and schema version, so the singleton rows, the ledger chain
  and every per-install limit keep their meaning.
- **One shared schema, `cloud`, for Cloud-only tables:** `agent_leases` (spec 3, section 6.5). No
  install table lives there.
- **Migrations per install.** The same numbered migrations, written once more in Postgres form, run
  on each install's schemas, each in one transaction with its version bump. An install whose
  schema version is newer than the build is refused, as on SQLite
  ([decision 0062](../DECISIONS.md#d0062)).
- **The same row shapes.** Every column reads back as the value SQLite gives: times are `bigint`
  epoch milliseconds; flags are `smallint` checked to `0` or `1`; other integers are `bigint`;
  amounts, USD micros, block numbers and other decimal base units are `numeric(78,0)`, which reads
  back as the same decimal text; JSON is `text` checked `IS JSON`; every other text is
  `text COLLATE "C"`. Spec 3, section 6.3 maps each SQLite rule to its Postgres form.
- **The same checks.** Each `CHECK`, unique index, partial index and trigger of the SQLite schema has
  its Postgres form, so a row one database refuses the other refuses too. The ledger and the
  transcript refuse changes by trigger, and no role holds `UPDATE` or `DELETE` on the ledger.
- **Note search** uses the `pg_trgm` extension for the agent schema's notes, the one extension the
  store needs.

## Consequences

- The store's tasks, row types and schemas serve both adapters; only the dialect, the migrations and
  the Postgres checks are written twice.
- A user's data is a schema pair: the roles' grants, a user's delete and a restore of one user act
  on it alone.
- Each new install adds two schemas, and a deploy migrates every install. A few thousand installs is
  within what Postgres serves; a much larger count would need its own decision.
- Where a SQLite column holds decimal text, Postgres can sum and compare it as a number; the store
  keeps its money math in `bigint` code on both, so neither depends on that.
- `json_extract` in a query becomes `#>>` over the text cast to `jsonb` on Postgres; the one store
  query that reads JSON in SQL (copy buys by leader) gets its Postgres form.

## Alternatives

- **Shared tables with an install column.** Every key, unique index, singleton row and query would
  gain the column on both adapters, a change to every self-hosted table, and one missed filter would
  show one user's rows to another.
- **One database per install.** The same isolation, but a connection pool per user per worker and
  no shared `cloud` schema for leases in the same transaction as a write.
- **`boolean`, `jsonb` and identity columns.** Native, but each changes the row shape or the stored
  text, or the order rows read
  ([decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md)),
  so the store's code would split by dialect.
