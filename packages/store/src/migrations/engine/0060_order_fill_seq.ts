import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite adds a column with a
// default in place; the update numbers every row in the order the store read them before, the time
// then the row number, so no read changes for a row written before. The trigger takes each new
// row's number from the counter in the insert's own transaction, after the insert wrote 0.
const sql = `
CREATE TABLE counters (
  name TEXT PRIMARY KEY NOT NULL,
  last INTEGER NOT NULL CHECK (last >= 0)
) STRICT;

ALTER TABLE order_fills ADD COLUMN seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE order_fills SET seq = ranked.n
FROM (SELECT rowid AS row, row_number() OVER (ORDER BY at, rowid) AS n FROM order_fills) AS ranked
WHERE order_fills.rowid = ranked.row;

INSERT INTO counters (name, last) SELECT 'order_fills', coalesce(max(seq), 0) FROM order_fills;

CREATE UNIQUE INDEX order_fills_seq ON order_fills (seq);

CREATE TRIGGER order_fills_seq_next AFTER INSERT ON order_fills
BEGIN
  UPDATE counters SET last = last + 1 WHERE name = 'order_fills';
  UPDATE order_fills SET seq = (SELECT last FROM counters WHERE name = 'order_fills')
  WHERE rowid = NEW.rowid;
END;
`;

/**
 * Gives `order_fills` a write-order number, `seq` (decision 0366): the `counters` row of the table
 * counts each row the store writes, in the transaction that writes it, so a read in write order
 * needs neither SQLite's row number nor an id's random bits. Rows written before are numbered in
 * the order the store read them.
 */
export const migration: Migration = {
  name: "0060_order_fill_seq",
  up(database) {
    database.exec(sql);
  },
};
