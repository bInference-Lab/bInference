import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. `counters` exists since
// agent 0001 here. Messages kept before are numbered by the time they arrived, then by id. The
// trigger sets each new message's number from the counter in the insert's own transaction,
// whatever the insert wrote.
const sql = `
ALTER TABLE chat_queue ADD COLUMN seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE chat_queue SET seq = ranked.n
FROM (
  SELECT message, row_number() OVER (ORDER BY received_at, message) AS n FROM chat_queue
) AS ranked
WHERE chat_queue.message = ranked.message;

INSERT INTO counters AS c (name, last) SELECT 'chat_queue', coalesce(max(seq), 0) FROM chat_queue
  ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, EXCLUDED.last);

CREATE UNIQUE INDEX chat_queue_seq ON chat_queue (seq);

CREATE FUNCTION chat_queue_seq_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO counters AS c (name, last) VALUES ('chat_queue', 1)
    ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.seq;
  RETURN NEW;
END $$;

CREATE TRIGGER chat_queue_seq_next BEFORE INSERT ON chat_queue
  FOR EACH ROW EXECUTE FUNCTION chat_queue_seq_next();
`;

/**
 * Gives `chat_queue` a write-order key, `seq`, from its counter row (decision 0366), as agent 0005
 * does.
 */
export const migration: PostgresMigration = { name: "0005_chat_queue_seq", sql };
