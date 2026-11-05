import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite adds a column with a
// default in place; the update numbers every message in the order a session's queue read them
// before, by the time it arrived, then by id. The trigger takes each new message's number from the
// counter in the insert's own transaction, after the insert wrote 0.
const sql = `
CREATE TABLE counters (
  name TEXT PRIMARY KEY NOT NULL,
  last INTEGER NOT NULL CHECK (last >= 0)
) STRICT;

ALTER TABLE chat_queue ADD COLUMN seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE chat_queue SET seq = ranked.n
FROM (
  SELECT message, row_number() OVER (ORDER BY received_at, message) AS n FROM chat_queue
) AS ranked
WHERE chat_queue.message = ranked.message;

INSERT INTO counters (name, last) SELECT 'chat_queue', coalesce(max(seq), 0) FROM chat_queue;

CREATE UNIQUE INDEX chat_queue_seq ON chat_queue (seq);

CREATE TRIGGER chat_queue_seq_next AFTER INSERT ON chat_queue
BEGIN
  UPDATE counters SET last = last + 1 WHERE name = 'chat_queue';
  UPDATE chat_queue SET seq = (SELECT last FROM counters WHERE name = 'chat_queue')
  WHERE rowid = NEW.rowid;
END;
`;

/**
 * Gives `chat_queue` a write-order key, `seq` (decision 0366), from a `counters` row of the agent
 * database, so a turn reads the messages that wait in the order they arrived, whatever their ids.
 * Messages kept before are numbered by the time they arrived, then by id.
 */
export const migration: Migration = {
  name: "0005_chat_queue_seq",
  up(database) {
    database.exec(sql);
  },
};
