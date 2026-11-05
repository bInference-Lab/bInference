import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. pg_trgm's operator class
// lives in the shared schema, which the runner puts on the search path; the index keeps itself
// in step with every insert, change and removal.
const sql = `
CREATE TABLE notes (
  id bigint PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL,
  text text COLLATE "C" NOT NULL,
  origin text COLLATE "C" NOT NULL CHECK (origin IN ('owner', 'agent', 'untrusted', 'system')),
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  deleted_at bigint
);

CREATE INDEX notes_agent ON notes (agent_id);

CREATE INDEX notes_text_trgm ON notes USING gin (text gin_trgm_ops);

CREATE OR REPLACE FUNCTION notes_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('notes', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('notes', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER notes_id_next BEFORE INSERT ON notes
  FOR EACH ROW EXECUTE FUNCTION notes_id_next();
`;

/**
 * Creates `notes`, with a trigram index on their text in place of SQLite's notes_fts, as agent 0003
 * does.
 */
export const migration: PostgresMigration = { name: "0003_notes", sql };
