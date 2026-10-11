import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
//
// The transcript is append-only: a change of an event always fails, and so does a removal, except
// of an event older than `meta.prune_before`, which only the retention task sets, inside its own
// transaction. notes_fts moves to the trigram tokenizer, which finds a word inside Chinese text
// that has no spaces between words; it is rebuilt from the notes it indexes.
const sql = `
ALTER TABLE turns ADD COLUMN held_back INTEGER NOT NULL DEFAULT 0 CHECK (held_back >= 0);

ALTER TABLE transcript_events ADD COLUMN outside INTEGER NOT NULL DEFAULT 0 CHECK (
  outside IN (0, 1)
);

CREATE TRIGGER transcript_events_refuse_changes BEFORE UPDATE ON transcript_events
BEGIN
  SELECT RAISE(ABORT, 'the transcript is append-only');
END;

CREATE TRIGGER transcript_events_refuse_removal BEFORE DELETE ON transcript_events
WHEN OLD.at >= coalesce((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'prune_before'), 0)
BEGIN
  SELECT RAISE(ABORT, 'the transcript is append-only');
END;

CREATE TABLE chat_queue (
  message TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'inbox/message', 'inbox/intentSettled', 'inbox/orderSettled', 'inbox/scheduleDue',
    'inbox/alertFired', 'inbox/resumeReport', 'inbox/stop', 'inbox/clear'
  )),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  received_at INTEGER NOT NULL,
  turn_id TEXT,
  dropped_at INTEGER,
  drop_reason TEXT CHECK (drop_reason IS NULL OR length(drop_reason) BETWEEN 1 AND 64),
  CHECK ((dropped_at IS NULL) = (drop_reason IS NULL)),
  CHECK (turn_id IS NULL OR dropped_at IS NULL)
) STRICT;

CREATE INDEX chat_queue_session_received ON chat_queue (session_id, received_at);

DROP TRIGGER notes_fts_insert;
DROP TRIGGER notes_fts_delete;
DROP TRIGGER notes_fts_update;
DROP TABLE notes_fts;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  text,
  content = 'notes',
  content_rowid = 'id',
  tokenize = 'trigram'
);

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

INSERT INTO notes_fts (notes_fts) VALUES ('rebuild');
`;

/**
 * Brings the agent database to spec 8 (database spec, section 3): `turns.held_back`,
 * `transcript_events.outside`, the append-only transcript, `chat_queue`, and `notes_fts` on the
 * trigram tokenizer.
 */
export const migration: Migration = {
  name: "0004_runtime_chats",
  up(database) {
    database.exec(sql);
  },
};
