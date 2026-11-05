import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. `counters` exists since
// engine 0001 here. Rows written before are numbered by time, then id. The trigger sets each new
// row's number from the counter in the insert's own transaction, whatever the insert wrote.
const sql = `
ALTER TABLE order_fills ADD COLUMN seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE order_fills SET seq = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY at, id) AS n FROM order_fills) AS ranked
WHERE order_fills.id = ranked.id;

INSERT INTO counters AS c (name, last) SELECT 'order_fills', coalesce(max(seq), 0) FROM order_fills
  ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, EXCLUDED.last);

CREATE UNIQUE INDEX order_fills_seq ON order_fills (seq);

CREATE FUNCTION order_fills_seq_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO counters AS c (name, last) VALUES ('order_fills', 1)
    ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.seq;
  RETURN NEW;
END $$;

CREATE TRIGGER order_fills_seq_next BEFORE INSERT ON order_fills
  FOR EACH ROW EXECUTE FUNCTION order_fills_seq_next();
`;

/**
 * Gives `order_fills` a write-order number, `seq`, from its counter row (decision 0366), as engine
 * 0060 does.
 */
export const migration: PostgresMigration = { name: "0060_order_fill_seq", sql };
