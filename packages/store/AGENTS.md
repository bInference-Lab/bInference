# @binference/store

Kysely on `node:sqlite` in worker threads: the dialect, the store workers, migrations, schema
versions and integrity checks. The databases are [docs/specs/database.md](../../docs/specs/database.md).

The root [AGENTS.md](../../AGENTS.md) and [core's schema pattern](../core/AGENTS.md) apply here.
Rules for this package:

- No database work runs on the main thread. A connection lives on a store worker, and only a
  `*.worker.ts` module may import `node:sqlite` as a value or import another worker module. The
  main thread calls `openDatabase` and sends store tasks to the workers.
- Each database has one writer worker: writes run one at a time, in arrival order, each in one
  transaction. Reads run on reader workers, which open `query_only`.
- A store task is defined with `defineTask` and listed in its database's definition
  (`src/databases/`). Its `run` is synchronous: plan the async work before the call, then reread
  the rows that decide and write. Input and output pass through their zod schemas on each side.
- Queries use Kysely through `createSyncKysely`. Raw SQL appears only in `src/migrations/`,
  `src/sqlite/` (opening pragmas, transaction control, integrity checks, `VACUUM INTO`) and the
  copied dialect in `src/dialect/`.
- Migrations are `src/migrations/<database>/NNNN_name.ts`, numbered from 0001 with no gap, listed
  in order in `<database>-migrations.ts`, forward-only, with no `down`. Each runs in one
  transaction with its version bump. `pnpm check:store --write` locks a new file's hash in
  `migrations.lock.json`; a migration in the lock on `master` never changes again. The
  `add-migration` skill has the steps.
- The ledger is append-only: no `updateTable`, `deleteFrom` or `replaceInto` on it, in code or SQL.
  One file writes `intents.state`: the intent state machine's store adapter.
- `pnpm check:store` enforces these rules.
- Tests that start workers pass `execArgv` with `--conditions=@binference/source` and
  `--import tsx`, so the workers run the TypeScript source. They close every handle before they
  delete a file: Windows refuses to delete a file a connection holds.
- `src/dialect/` holds code adapted from an MIT-licensed project; `NOTICES.md` holds its notice.
  Keep each file's header.
