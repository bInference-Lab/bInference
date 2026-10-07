# @binference/store

## Purpose

The engine and the agent runtime keep their state in SQLite files, `engine.sqlite` and
`agent.sqlite` ([docs/specs/database.md](../../docs/specs/database.md)). This package opens them
on worker threads, so no query blocks the main thread:

- **Store workers.** Each database has one writer worker, which runs writes one at a time in the
  order they arrive, each in its own transaction, and reader workers, which open read-only. Every
  connection uses WAL, foreign keys and a 5-second busy timeout set before its first statement;
  the engine database syncs fully.
- **Store tasks.** A task is a named, synchronous unit of work with zod schemas for its input and
  output. The main thread sends a task by name; a worker runs it through Kysely.
- **Kysely on `node:sqlite`.** A synchronous dialect compiles Kysely queries and runs them with a
  bounded cache of prepared statements.
- **Migrations and schema versions.** Numbered, forward-only migrations, each in one transaction
  with its version bump in `meta`. A database with a newer schema than the build knows is refused.
- **The schemas.** Every table of the engine database (spec section 2) and the agent database's
  chats and notes (section 3), with their keys, indexes and checks. Every table is `STRICT`, so
  SQLite refuses a value of the wrong type. Amounts are decimal text, checked for digits only;
  flags are checked as 0 or 1 and JSON columns with `json_valid`. Triggers keep the ledger
  append-only and chained: an insert must take the next `seq` and the last entry's hash, and no
  row changes or goes. A full-text index keeps the notes searchable.
- **SQLite adapters of the store ports.** The engine declares its store ports (`IntentStore`,
  `LedgerStore`, `IdempotencyStore`, `InboxStore`, `AccessStore`, `AgentStore`, `InstallStore`,
  `ConfigJournal`, `TransactionStore`, `WalletStore`);
  each adapter here runs one store task per call and passes the port's contract suite.
- **Maintenance.** SQLite's integrity and foreign key checks, and compact copies with
  `VACUUM INTO`.

## API

| Export                         | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `openDatabase`                 | Starts a database's writer and reader workers; refuses newer schemas |
| `DatabaseHandle`               | `migrate`, `run`, `checkIntegrity`, `vacuumInto` and `close`         |
| `engineWorker`, `agentWorker`  | The worker entries of the engine and agent databases                 |
| `StoreTask`, `TaskAccess`      | A store task and where it runs, `read` or `write`                    |
| `MigrationReport`              | What a migration run applied, and the versions before and after      |
| `IntegrityReport`              | The integrity check, foreign key problems and the schema version     |
| `VacuumOutcome`, `VacuumCopy`  | The copy `vacuumInto` wrote, or `target_exists`                      |
| `CallOptions`                  | The caller's signal and an optional time limit for one call          |
| `createSqliteEngineStores`     | Every engine store port on an open `engine.sqlite` handle            |
| `createSqliteIntentStore`      | Intents, events, cards and confirmations; each move in one write     |
| `createSqliteLedgerStore`      | The hash-chained ledger                                              |
| `createSqliteIdempotencyStore` | Each write's result by its idempotency key                           |
| `createSqliteInboxStore`       | Inbound Telegram updates and webhook calls, stored before the ack    |
| `createSqliteAccessStore`      | Client tokens, console devices and pairing codes                     |
| `createSqliteAgentStore`       | Agents with their limits and approval modes                          |
| `createSqliteWalletStore`      | The agent wallets with the owner's labels, oldest first              |
| `createSqliteInstallStore`     | The install id, its custody, the rescue address and init's wallets   |
| `createSqliteConfigJournal`    | The config journal                                                   |
| `createSqliteTransactionStore` | Each wallet's signed transactions and the nonces the queue gave      |
| `StoreHost`                    | What an adapter sends its tasks to: a `DatabaseHandle`               |

Error codes start with `store.`: `store.newer_schema` when the file is newer than the build,
`store.migration_failed` when a migration rolled back, `store.busy` when another connection held
the lock past the busy timeout, `store.aborted` and `store.timeout` when a call stopped waiting.

A store call checks its signal before it sends its task, so a call on an aborted signal changes
nothing. Expected outcomes, such as a stale version, come back as a `Result`; a broken rule throws:
`store.constraint` when SQLite refuses the write, `store.card_not_open` when a move closes a card
that is not open.

`pnpm check:store` keeps the rules: raw SQL only in migrations and the connection layer,
synchronous transaction callbacks, an append-only ledger, one writer of `intents.state`, numbered
migrations with no `down` whose released files never change, and `node:sqlite` only on workers.

## Example

The composition root opens the engine database, migrates it after the backup, checks it and hands
its store ports to the engine:

```ts
import { createSqliteEngineStores, engineWorker, openDatabase } from "@binference/store";

const engine = await openDatabase({
  file: stateFolder.engineDatabase,
  worker: engineWorker,
  signal: AbortSignal.timeout(30_000),
});
const migrated = await engine.migrate({ signal });
const report = await engine.checkIntegrity({ signal });
if (!report.ok) {
  throw new Error(`engine.sqlite failed its integrity check at version ${report.schemaVersion}`);
}
const stores = createSqliteEngineStores(engine);
const moved = await stores.intents.transition(change, { signal });
if (!moved.ok && moved.error === "stale") {
  // Someone moved the intent first: read it again and decide again.
}
await engine.close();
```
