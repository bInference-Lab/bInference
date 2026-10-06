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
- **Maintenance.** SQLite's integrity and foreign key checks, and compact copies with
  `VACUUM INTO`.

## API

| Export                        | What it does                                                         |
| ----------------------------- | -------------------------------------------------------------------- |
| `openDatabase`                | Starts a database's writer and reader workers; refuses newer schemas |
| `DatabaseHandle`              | `migrate`, `run`, `checkIntegrity`, `vacuumInto` and `close`         |
| `engineWorker`, `agentWorker` | The worker entries of the engine and agent databases                 |
| `StoreTask`, `TaskAccess`     | A store task and where it runs, `read` or `write`                    |
| `MigrationReport`             | What a migration run applied, and the versions before and after      |
| `IntegrityReport`             | The integrity check, foreign key problems and the schema version     |
| `VacuumOutcome`, `VacuumCopy` | The copy `vacuumInto` wrote, or `target_exists`                      |
| `CallOptions`                 | The caller's signal and an optional time limit for one call          |

Error codes start with `store.`: `store.newer_schema` when the file is newer than the build,
`store.migration_failed` when a migration rolled back, `store.busy` when another connection held
the lock past the busy timeout, `store.aborted` and `store.timeout` when a call stopped waiting.

## Example

The composition root opens the engine database, migrates it after the backup and checks it:

```ts
import { engineWorker, openDatabase } from "@binference/store";

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
await engine.close();
```
