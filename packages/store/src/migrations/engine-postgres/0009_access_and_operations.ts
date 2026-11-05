import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE tokens (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  label text COLLATE "C" NOT NULL,
  kind text COLLATE "C" NOT NULL CHECK (kind IN ('cli', 'runtime', 'mcp', 'custom')),
  scopes text COLLATE "C" CHECK (scopes IS JSON) NOT NULL,
  secret_hash text COLLATE "C" NOT NULL
    CHECK (length(secret_hash) = 64 AND secret_hash !~ '[^0-9a-f]') UNIQUE,
  created_at bigint NOT NULL,
  last_used_at bigint,
  revoked_at bigint
);

CREATE TABLE devices (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  label text COLLATE "C" NOT NULL,
  alg text COLLATE "C" NOT NULL CHECK (alg IN ('ed25519', 'p256')),
  public_key text COLLATE "C" NOT NULL,
  created_at bigint NOT NULL,
  last_seen_at bigint,
  revoked_at bigint
);

CREATE TABLE pair_codes (
  code_hash text COLLATE "C" NOT NULL
    CHECK (length(code_hash) = 64 AND code_hash !~ '[^0-9a-f]') PRIMARY KEY,
  expires_at bigint NOT NULL,
  used_at bigint
);

CREATE TABLE config_journal (
  id bigint PRIMARY KEY NOT NULL,
  at bigint NOT NULL,
  "by" text COLLATE "C" NOT NULL,
  surface text COLLATE "C" NOT NULL,
  path text COLLATE "C" NOT NULL,
  "before" text COLLATE "C" CHECK ("before" IS JSON),
  "after" text COLLATE "C" CHECK ("after" IS JSON),
  reason text COLLATE "C"
);

CREATE INDEX config_journal_at ON config_journal (at);

CREATE FUNCTION config_journal_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('config_journal', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('config_journal', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER config_journal_id_next BEFORE INSERT ON config_journal
  FOR EACH ROW EXECUTE FUNCTION config_journal_id_next();

CREATE TABLE plugins (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  name text COLLATE "C" NOT NULL UNIQUE,
  version text COLLATE "C" NOT NULL,
  tier text COLLATE "C" NOT NULL CHECK (tier IN ('core', 'community')),
  source text COLLATE "C" NOT NULL,
  hash text COLLATE "C" NOT NULL,
  permissions text COLLATE "C" CHECK (permissions IS JSON) NOT NULL,
  enabled smallint NOT NULL CHECK (enabled IN (0, 1)),
  installed_at bigint NOT NULL
);

CREATE TABLE skills (
  id bigint PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  name text COLLATE "C" NOT NULL,
  source text COLLATE "C" NOT NULL,
  hash text COLLATE "C" NOT NULL,
  installed_at bigint NOT NULL,
  UNIQUE (agent_id, name)
);

CREATE FUNCTION skills_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('skills', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('skills', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER skills_id_next BEFORE INSERT ON skills
  FOR EACH ROW EXECUTE FUNCTION skills_id_next();

CREATE TABLE jobs (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  kind text COLLATE "C" NOT NULL,
  state text COLLATE "C" NOT NULL CHECK (state IN ('running', 'done', 'failed')),
  progress text COLLATE "C" CHECK (progress IS JSON),
  result text COLLATE "C" CHECK (result IS JSON),
  error text COLLATE "C" CHECK (error IS JSON),
  started_at bigint NOT NULL,
  ended_at bigint
);

CREATE INDEX jobs_state ON jobs (state);

CREATE TABLE backups (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  path text COLLATE "C" NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  kind text COLLATE "C" NOT NULL CHECK (
    kind IN ('daily', 'weekly', 'manual', 'before_update', 'before_migration')
  ),
  created_at bigint NOT NULL,
  verified_at bigint
);

CREATE INDEX backups_created ON backups (created_at);

CREATE TABLE cex_connections (
  provider text COLLATE "C" PRIMARY KEY NOT NULL CHECK (provider IN ('binance')),
  state text COLLATE "C" NOT NULL,
  secret_ref text COLLATE "C" NOT NULL,
  scopes text COLLATE "C" CHECK (scopes IS JSON) NOT NULL,
  connected_at bigint NOT NULL
);
`;

/**
 * Creates access, plugins, skills, jobs, backups and exchange connections (database spec, section
 * 2.8), as engine 0009 does.
 */
export const migration: PostgresMigration = { name: "0009_access_and_operations", sql };
