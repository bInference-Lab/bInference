import type { Migration } from "../migration.js";

// A released migration never changes, so each one writes its SQL out in full.
const sql = `
CREATE TABLE safety (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  frozen_at INTEGER,
  rescue_address TEXT,
  pending_rescue_address TEXT,
  pending_rescue_at INTEGER,
  disclaimer_version TEXT,
  disclaimer_accepted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  CHECK ((pending_rescue_address IS NULL) = (pending_rescue_at IS NULL)),
  CHECK ((disclaimer_version IS NULL) = (disclaimer_accepted_at IS NULL))
) STRICT;

INSERT INTO safety (id) VALUES (1);

CREATE TABLE custody (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  provider TEXT NOT NULL CHECK (provider IN ('privy')),
  app_id TEXT NOT NULL,
  owner_quorum_id TEXT NOT NULL,
  owner_key_public TEXT NOT NULL,
  agent_quorum_id TEXT NOT NULL,
  agent_key_public TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;
`;

/**
 * Creates `safety`, its one row, and `custody` (database spec, section 2.1): the freeze, the rescue
 * address and its 24-hour change, the accepted disclaimer, and the Privy custody of the install.
 */
export const migration: Migration = {
  name: "0002_install_and_safety",
  up(database) {
    database.exec(sql);
  },
};
