import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE safety (
  id bigint PRIMARY KEY NOT NULL CHECK (id = 1),
  frozen_at bigint,
  rescue_address text COLLATE "C",
  pending_rescue_address text COLLATE "C",
  pending_rescue_at bigint,
  disclaimer_version text COLLATE "C",
  disclaimer_accepted_at bigint,
  version bigint NOT NULL DEFAULT 0,
  CHECK ((pending_rescue_address IS NULL) = (pending_rescue_at IS NULL)),
  CHECK ((disclaimer_version IS NULL) = (disclaimer_accepted_at IS NULL))
);

INSERT INTO safety (id) VALUES (1);

CREATE TABLE custody (
  id bigint PRIMARY KEY NOT NULL CHECK (id = 1),
  provider text COLLATE "C" NOT NULL CHECK (provider IN ('privy')),
  app_id text COLLATE "C" NOT NULL,
  owner_quorum_id text COLLATE "C" NOT NULL,
  owner_key_public text COLLATE "C" NOT NULL,
  agent_quorum_id text COLLATE "C" NOT NULL,
  agent_key_public text COLLATE "C" NOT NULL,
  attached_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);
`;

/**
 * Creates `safety`, its one row, and `custody` (database spec, section 2.1), as engine 0002 does.
 */
export const migration: PostgresMigration = { name: "0002_install_and_safety", sql };
