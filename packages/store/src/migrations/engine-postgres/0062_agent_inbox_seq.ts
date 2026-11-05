import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. Messages kept before are
// numbered by time, then id. The trigger sets each new row's number from the counter in the
// insert's own transaction, whatever the insert wrote.
const sql = `
ALTER TABLE agent_inbox ADD COLUMN seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE agent_inbox SET seq = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM agent_inbox) AS ranked
WHERE agent_inbox.id = ranked.id;

INSERT INTO counters AS c (name, last) SELECT 'agent_inbox', coalesce(max(seq), 0) FROM agent_inbox
  ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, EXCLUDED.last);

CREATE UNIQUE INDEX agent_inbox_seq ON agent_inbox (seq);

CREATE FUNCTION agent_inbox_seq_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO counters AS c (name, last) VALUES ('agent_inbox', 1)
    ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.seq;
  RETURN NEW;
END $$;

CREATE TRIGGER agent_inbox_seq_next BEFORE INSERT ON agent_inbox
  FOR EACH ROW EXECUTE FUNCTION agent_inbox_seq_next();
`;

/**
 * Gives `agent_inbox` a write-order key, `seq`, from its counter row (decision 0366), as engine
 * 0062 does.
 */
export const migration: PostgresMigration = { name: "0062_agent_inbox_seq", sql };
