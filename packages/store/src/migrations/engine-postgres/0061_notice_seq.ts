import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. Notices written before
// are numbered by id. The trigger sets each new row's number from the counter in the insert's
// own transaction, whatever the insert wrote.
const sql = `
ALTER TABLE notices ADD COLUMN seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0);

UPDATE notices SET seq = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM notices) AS ranked
WHERE notices.id = ranked.id;

INSERT INTO counters AS c (name, last) SELECT 'notices', coalesce(max(seq), 0) FROM notices
  ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, EXCLUDED.last);

CREATE UNIQUE INDEX notices_seq ON notices (seq);

CREATE FUNCTION notices_seq_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO counters AS c (name, last) VALUES ('notices', 1)
    ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.seq;
  RETURN NEW;
END $$;

CREATE TRIGGER notices_seq_next BEFORE INSERT ON notices
  FOR EACH ROW EXECUTE FUNCTION notices_seq_next();
`;

/**
 * Gives `notices` a write-order number, `seq`, from its counter row (decision 0366), as engine 0061
 * does.
 */
export const migration: PostgresMigration = { name: "0061_notice_seq", sql };
