/**
 * One forward-only migration in its Postgres form, from the file `NNNN_name.ts` in
 * `src/migrations/<database>-postgres/`, numbered as the SQLite migration it mirrors. Its `sql`
 * names no schema: the runner sets the transaction's `search_path` to the schema it migrates, and
 * a function the migration creates keeps that path with `SET search_path FROM CURRENT`. The runner
 * applies it in one transaction with its version bump; there is no `down`.
 */
export interface PostgresMigration {
  /** The file name without its extension, such as `0001_meta`; its number is its version. */
  readonly name: string;
  /** One or more statements, run as written. */
  readonly sql: string;
}

/** A schema's migrations, oldest first, and the name errors and reports give its database. */
export interface PostgresMigrationPlan {
  readonly name: string;
  readonly migrations: readonly PostgresMigration[];
}
