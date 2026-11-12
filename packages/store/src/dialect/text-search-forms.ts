import { type RawBuilder, type SqlBool, sql } from "kysely";

/**
 * The full-text index of a text column (database spec, section 6.3). On SQLite it is an FTS5 table
 * with the trigram tokenizer, which a search joins, matches and ranks by. On Postgres it is a
 * pg_trgm GIN index on the column itself, which serves `holdsText`, and a search ranks by the
 * trigram similarity of the column's text and the query, the highest first (decision 0366); the
 * function lives in the agent schema (agent migration 0009).
 */
export type FullTextIndex =
  | { readonly kind: "fts5" }
  | {
      readonly kind: "trigram";
      readonly similarity: (reference: string, text: string) => RawBuilder<number>;
    };

// The characters Postgres's LIKE reads as its own, each escaped with its default escape, `\`.
const likeOwn = /[\\%_]/gu;

/** SQLite's `holdsText`: `lower` folds ASCII letters only, and `instr` reads no wildcard. */
export function sqliteHoldsText(reference: string, text: string): RawBuilder<SqlBool> {
  return sql<SqlBool>`instr(lower(${sql.ref(reference)}), lower(${text})) > 0`;
}

/**
 * Postgres's `holdsText`: `ILIKE` under the `C` collation, whose `lower` folds ASCII letters only,
 * with every character LIKE reads as its own escaped.
 */
export function postgresHoldsText(reference: string, text: string): RawBuilder<SqlBool> {
  const pattern = `%${text.replaceAll(likeOwn, "\\$&")}%`;
  return sql<SqlBool>`${sql.ref(reference)} COLLATE "C" ILIKE ${pattern}`;
}

/** Postgres's full-text index, ranked by `trigram_similarity` in the install's `schema`. */
export function postgresFullText(schema: string): FullTextIndex {
  return {
    kind: "trigram",
    similarity: (reference, text) =>
      sql<number>`${sql.id(schema, "trigram_similarity")}(${sql.ref(reference)}, ${text})`,
  };
}
