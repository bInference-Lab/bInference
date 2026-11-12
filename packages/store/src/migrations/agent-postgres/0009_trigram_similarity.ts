import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. pg_trgm lives in the
// shared schema, which a store session's empty search path never names; the standard SQL body
// binds `similarity` once, here, through the runner's search path, so a search calls the function
// by this schema's name alone.
const sql = `
CREATE FUNCTION trigram_similarity(content text, query text) RETURNS real
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN similarity(content, query);
`;

/**
 * Adds `trigram_similarity`, pg_trgm's similarity of a text and a query, which a note search
 * ranks by in place of FTS5's rank (database spec, section 6.3; decision 0366).
 */
export const migration: PostgresMigration = { name: "0009_trigram_similarity", sql };
