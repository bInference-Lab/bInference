import type { Compilable, CompiledQuery, Kysely, QueryResult } from "kysely";

/** A query to run: a Kysely builder, or SQL a migration or check compiled. */
type RunnableQuery<Row> = Compilable<Row> | CompiledQuery<Row>;

/** One transaction's view of Postgres: Kysely to build queries, and the two calls that run them. */
export interface PostgresConnection<Schema> {
  /** Builds queries inside the transaction. Name each table's schema with `withSchema`. */
  readonly kysely: Kysely<Schema>;
  /** Runs a query with the call's signal and returns its rows or its affected-row count. */
  readonly execute: <Row>(query: RunnableQuery<Row>) => Promise<QueryResult<Row>>;
  /** Runs a query with the call's signal and returns its first row. */
  readonly takeFirst: <Row>(query: RunnableQuery<Row>) => Promise<Row | undefined>;
}

/**
 * Binds a transaction's Kysely to the call's signal. On an abort a query stops waiting, and the
 * transaction rolls back once the server ends the query (decision 0365).
 */
export function connectionOf<Schema>(
  kysely: Kysely<Schema>,
  signal: AbortSignal,
): PostgresConnection<Schema> {
  const execute = async <Row>(query: RunnableQuery<Row>): Promise<QueryResult<Row>> =>
    kysely.executeQuery(query, { signal, inflightQueryAbortStrategy: "ignore query" });
  return {
    kysely,
    execute,
    takeFirst: async (query) => (await execute(query)).rows[0],
  };
}
