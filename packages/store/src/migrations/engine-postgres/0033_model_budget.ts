import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The new table first, the
// rows copied, the old one dropped, then renamed, as on SQLite; a row stored before keeps a key
// made from its id.
const sql = `
CREATE TABLE model_usage_new (
  id bigint PRIMARY KEY NOT NULL,
  key text COLLATE "C" NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 64),
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  turn_id text COLLATE "C" CHECK (turn_id IS NULL OR turn_id ~ '^trn_'),
  model text COLLATE "C" NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cached_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  usd_micros numeric(78,0) NOT NULL CHECK (usd_micros >= 0),
  at bigint NOT NULL
);

INSERT INTO model_usage_new (
  id, key, agent_id, turn_id, model, input_tokens, output_tokens, cached_tokens, usd_micros, at
)
SELECT
  id, 'row.' || id, agent_id, turn_id, model, input_tokens, output_tokens, cached_tokens,
  usd_micros, at
FROM model_usage;

DROP TABLE model_usage;
ALTER TABLE model_usage_new RENAME TO model_usage;
ALTER INDEX model_usage_new_pkey RENAME TO model_usage_pkey;

CREATE INDEX model_usage_agent_at ON model_usage (agent_id, at);

CREATE OR REPLACE FUNCTION model_usage_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('model_usage', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('model_usage', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER model_usage_id_next BEFORE INSERT ON model_usage
  FOR EACH ROW EXECUTE FUNCTION model_usage_id_next();

CREATE TABLE budget_notices (
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  day_at bigint NOT NULL,
  at bigint NOT NULL,
  PRIMARY KEY (agent_id, day_at)
);
`;

/**
 * Makes `model_usage` again with each attempt's key, and creates `budget_notices`, as engine 0033
 * does.
 */
export const migration: PostgresMigration = { name: "0033_model_budget", sql };
