import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite adds a column with a
// default in place; the update numbers every notice in the order `notice/list` read them before, by
// id, so a cursor held before reads on as it did. The trigger takes each new notice's number from
// the counter in the insert's own transaction, after the insert wrote 0.
const sql = `
ALTER TABLE notices ADD COLUMN seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE notices SET seq = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM notices) AS ranked
WHERE notices.id = ranked.id;

INSERT INTO counters (name, last) SELECT 'notices', coalesce(max(seq), 0) FROM notices;

CREATE UNIQUE INDEX notices_seq ON notices (seq);

CREATE TRIGGER notices_seq_next AFTER INSERT ON notices
BEGIN
  UPDATE counters SET last = last + 1 WHERE name = 'notices';
  UPDATE notices SET seq = (SELECT last FROM counters WHERE name = 'notices')
  WHERE rowid = NEW.rowid;
END;
`;

/**
 * Gives `notices` a write-order key, `seq` (decision 0366), from its own `counters` row, so
 * `notice/list` reads on after a cursor in the order notices were recorded and never skips one
 * recorded in the cursor's millisecond. Notices recorded before are numbered in id order.
 */
export const migration: Migration = {
  name: "0061_notice_seq",
  up(database) {
    database.exec(sql);
  },
};
