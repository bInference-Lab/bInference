import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite adds a column with a
// default in place; the update numbers every message in the order `inbox/list` read them before, by
// time then id. The trigger takes each new message's number from the counter in the insert's own
// transaction, after the insert wrote 0.
const sql = `
ALTER TABLE agent_inbox ADD COLUMN seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE agent_inbox SET seq = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM agent_inbox) AS ranked
WHERE agent_inbox.id = ranked.id;

INSERT INTO counters (name, last) SELECT 'agent_inbox', coalesce(max(seq), 0) FROM agent_inbox;

CREATE UNIQUE INDEX agent_inbox_seq ON agent_inbox (seq);

CREATE TRIGGER agent_inbox_seq_next AFTER INSERT ON agent_inbox
BEGIN
  UPDATE counters SET last = last + 1 WHERE name = 'agent_inbox';
  UPDATE agent_inbox SET seq = (SELECT last FROM counters WHERE name = 'agent_inbox')
  WHERE rowid = NEW.rowid;
END;
`;

/**
 * Gives `agent_inbox` a write-order key, `seq` (decision 0366), from its own `counters` row, so
 * `inbox/list` hands the runtime its messages in the order they arrived and a page never skips one
 * that arrived in the cursor's millisecond. Messages kept before are numbered by time, then id.
 */
export const migration: Migration = {
  name: "0062_agent_inbox_seq",
  up(database) {
    database.exec(sql);
  },
};
