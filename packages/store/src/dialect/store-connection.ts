import type { DatabaseSync } from "node:sqlite";
import type { CompiledQuery, QueryResult } from "kysely";

/**
 * A store task's synchronous view of one Postgres transaction: the install's schema its queries
 * name, and the call that runs one statement inside the transaction and waits for its result.
 */
export interface PostgresTaskConnection {
  readonly dialect: "postgres";
  /** The schema every query names, such as `engine_<digits>` (database spec, section 6.2). */
  readonly schema: string;
  /**
   * Runs one compiled statement in the task's transaction and returns its rows, or its
   * affected-row count for a write without `returning`. It throws when the statement fails, the
   * call is aborted, or Postgres does not answer within its bound; the task then ends, and its
   * transaction rolls back.
   */
  run<Row>(query: CompiledQuery<Row>): QueryResult<Row>;
}

/**
 * The connection a store task runs its queries on, synchronously, inside the task's one
 * transaction: on SQLite, the store worker's `node:sqlite` connection; on Postgres, a
 * {@link PostgresTaskConnection}. A task passes it to `createSyncKysely` and to the row helpers
 * it calls, and never uses it any other way.
 */
export type StoreConnection = DatabaseSync | PostgresTaskConnection;
