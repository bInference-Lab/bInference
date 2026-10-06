import type { Migration } from "../migration.js";

// notes_fts indexes notes.text as external content keyed on the integer id, which VACUUM never
// renumbers; the triggers keep the index in step with every insert, change and removal.
const sql = `
CREATE TABLE notes (
  id INTEGER PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  text TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('owner', 'agent', 'untrusted', 'system')),
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE INDEX notes_agent ON notes (agent_id);

CREATE VIRTUAL TABLE notes_fts USING fts5(text, content = 'notes', content_rowid = 'id');

CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes
BEGIN
  INSERT INTO notes_fts (rowid, text) VALUES (NEW.id, NEW.text);
END;

CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes
BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, text) VALUES ('delete', OLD.id, OLD.text);
END;

CREATE TRIGGER notes_fts_update AFTER UPDATE OF text ON notes
BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, text) VALUES ('delete', OLD.id, OLD.text);
  INSERT INTO notes_fts (rowid, text) VALUES (NEW.id, NEW.text);
END;
`;

/**
 * Creates the agent's notes (database spec, section 3): `notes`, and `notes_fts`, a full-text
 * index over their text that triggers keep in step.
 */
export const migration: Migration = {
  name: "0003_notes",
  up(database) {
    database.exec(sql);
  },
};
