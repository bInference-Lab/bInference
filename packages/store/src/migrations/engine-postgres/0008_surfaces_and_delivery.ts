import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE inbox (
  id bigint PRIMARY KEY NOT NULL,
  source text COLLATE "C" NOT NULL CHECK (source IN ('telegram', 'webhook')),
  source_key text COLLATE "C" NOT NULL UNIQUE,
  payload text COLLATE "C" CHECK (payload IS JSON) NOT NULL,
  received_at bigint NOT NULL,
  handled_at bigint
);

CREATE FUNCTION inbox_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('inbox', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('inbox', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER inbox_id_next BEFORE INSERT ON inbox
  FOR EACH ROW EXECUTE FUNCTION inbox_id_next();

CREATE TABLE outbox (
  id bigint PRIMARY KEY NOT NULL,
  surface text COLLATE "C" NOT NULL,
  target text COLLATE "C" CHECK (target IS JSON) NOT NULL,
  payload text COLLATE "C" CHECK (payload IS JSON) NOT NULL,
  state text COLLATE "C" NOT NULL CHECK (state IN ('queued', 'sent', 'unknown_after_send', 'failed')),
  attempts bigint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_at bigint,
  ref text COLLATE "C",
  created_at bigint NOT NULL,
  sent_at bigint
);

CREATE INDEX outbox_state_next ON outbox (state, next_at);

CREATE FUNCTION outbox_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('outbox', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('outbox', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outbox_id_next BEFORE INSERT ON outbox
  FOR EACH ROW EXECUTE FUNCTION outbox_id_next();

CREATE TABLE notices (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" REFERENCES agents (id),
  kind text COLLATE "C" NOT NULL,
  i18n_key text COLLATE "C" NOT NULL,
  "values" text COLLATE "C" CHECK ("values" IS JSON) NOT NULL,
  level text COLLATE "C" NOT NULL,
  at bigint NOT NULL,
  delivered text COLLATE "C" CHECK (delivered IS JSON) NOT NULL
);

CREATE INDEX notices_at ON notices (at);

CREATE TABLE idempotency (
  credential text COLLATE "C" NOT NULL,
  op text COLLATE "C" NOT NULL,
  key text COLLATE "C" NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  args_hash text COLLATE "C" NOT NULL CHECK (length(args_hash) = 64 AND args_hash !~ '[^0-9a-f]'),
  result text COLLATE "C" CHECK (result IS JSON) NOT NULL,
  at bigint NOT NULL,
  PRIMARY KEY (credential, op, key)
);

CREATE TABLE model_usage (
  id bigint PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  turn_id text COLLATE "C",
  model text COLLATE "C" NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cached_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  usd_micros numeric(78,0) NOT NULL CHECK (usd_micros >= 0),
  at bigint NOT NULL
);

CREATE INDEX model_usage_agent_at ON model_usage (agent_id, at);

CREATE FUNCTION model_usage_id_next() RETURNS trigger LANGUAGE plpgsql
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
`;

/**
 * Creates the surfaces' inbox and outbox, notices, idempotency and model usage (database spec,
 * section 2.7), as engine 0008 does.
 */
export const migration: PostgresMigration = { name: "0008_surfaces_and_delivery", sql };
