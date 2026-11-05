import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. Triggers enforce the
// chain: an insert must take the next seq and link to the last hash, and no row ever changes or
// goes. The chain check fires before the counter trigger, by name.
const sql = `
CREATE TABLE ledger (
  seq bigint PRIMARY KEY NOT NULL,
  id text COLLATE "C" NOT NULL UNIQUE,
  at bigint NOT NULL,
  agent_id text COLLATE "C" REFERENCES agents (id),
  kind text COLLATE "C" NOT NULL,
  subject text COLLATE "C",
  data text COLLATE "C" NOT NULL CHECK (data IS JSON),
  prev_hash text COLLATE "C" NOT NULL CHECK (length(prev_hash) = 64 AND prev_hash !~ '[^0-9a-f]'),
  hash text COLLATE "C" NOT NULL UNIQUE CHECK (length(hash) = 64 AND hash !~ '[^0-9a-f]')
);

CREATE FUNCTION ledger_appends_to_chain() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.seq IS DISTINCT FROM (SELECT coalesce(max(seq), 0) + 1 FROM ledger)
    OR NEW.prev_hash IS DISTINCT FROM coalesce(
      (SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1),
      '0000000000000000000000000000000000000000000000000000000000000000'
    ) THEN
    RAISE EXCEPTION 'a ledger entry takes the next seq and the last entry''s hash';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ledger_appends_to_chain BEFORE INSERT ON ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_appends_to_chain();

CREATE FUNCTION ledger_seq_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO counters AS c (name, last) VALUES ('ledger', NEW.seq)
    ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.seq);
  RETURN NEW;
END $$;

CREATE TRIGGER ledger_seq_next BEFORE INSERT ON ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_seq_next();

CREATE FUNCTION ledger_refuses_changes() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only';
END $$;

CREATE TRIGGER ledger_refuses_changes BEFORE UPDATE ON ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_refuses_changes();

CREATE TRIGGER ledger_refuses_removal BEFORE DELETE ON ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_refuses_changes();
`;

/**
 * Creates the append-only, hash-chained `ledger` (database spec, section 2.5), as engine 0006 does.
 */
export const migration: PostgresMigration = { name: "0006_ledger", sql };
