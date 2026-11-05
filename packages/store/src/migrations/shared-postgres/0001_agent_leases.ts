import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. A lease row is free while
// no worker holds it: no worker, no take and no renewal. pg_trgm lives in this schema, once for the
// whole database, and each install's migrations find its operator class through their search path.
const sql = `
CREATE TABLE meta (
  key text COLLATE "C" PRIMARY KEY NOT NULL,
  value text COLLATE "C" NOT NULL
);

CREATE TABLE agent_leases (
  install_id text COLLATE "C" NOT NULL,
  agent_id text COLLATE "C" NOT NULL,
  worker_id text COLLATE "C",
  fence bigint NOT NULL CHECK (fence >= 1),
  taken_at bigint,
  renewed_at bigint,
  expires_at bigint NOT NULL,
  PRIMARY KEY (install_id, agent_id),
  CHECK ((worker_id IS NULL) = (taken_at IS NULL)),
  CHECK ((taken_at IS NULL) = (renewed_at IS NULL))
);

CREATE INDEX agent_leases_expires ON agent_leases (expires_at);

DO $$ BEGIN
  EXECUTE format('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA %I', current_schema());
END $$;
`;

/**
 * Creates the shared schema's `meta`, `agent_leases` (database spec, section 6.5) and the
 * `pg_trgm` extension that each agent schema's note search uses.
 */
export const migration: PostgresMigration = { name: "0001_agent_leases", sql };
