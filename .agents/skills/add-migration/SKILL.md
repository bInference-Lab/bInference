---
name: add-migration
description: Adds a database migration to the store package. Use when a change needs a new table, column or index, or a change to stored data.
---

# Add a migration

Migrations are numbered, forward-only and never edited after a release. `binference check --fix`
runs them after it takes a backup.

## 1. Name the file

- The next free number, four digits, then a snake_case name: `0007_add_order_tags.ts`.
- Never edit, rename or renumber a migration that has shipped. A mistake is fixed by the next
  migration.
- There is no `down` step.

## 2. Write it

- One migration runs in one transaction; a failure rolls all of it back.
- Tables and columns are snake_case.
- Ids are UUIDv7 text with their type prefix (`int_`, `ord_`, `cnf_`, `tx_`, `agt_`, `wal_`).
- Times are epoch milliseconds in UTC.
- Amounts are decimal strings of base units, never integers: SQLite integers stop at 64 bits.
- The ledger is append-only. A migration never updates or deletes ledger rows.
- Raw SQL belongs in migrations and the schema bootstrap only. Queries elsewhere use Kysely.

## 3. Move the code with it

- The store port and its SQLite adapter change in the same commit as the migration.
- Write transactions stay synchronous: plan the async work first, reread the rows that decide,
  then write and commit.
- A new money column gets a contract test that round-trips 2^64 + 1.

## 4. Test

- The migrated-schema test sees the new table or column.
- Run the store's contract suite and the migration runner test.
- Run `pnpm check`.

## 5. Report

Name the migration, what it changes, and the tests that cover it. Mention it in the pull request
body, since it changes every user's database on the next start.
