import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE safety ADD COLUMN breaker_at INTEGER CHECK (breaker_at IS NULL OR breaker_at >= 0);
ALTER TABLE safety ADD COLUMN breaker_version INTEGER NOT NULL DEFAULT 0
  CHECK (breaker_version >= 0);
ALTER TABLE safety ADD COLUMN breaker_told INTEGER NOT NULL DEFAULT 0
  CHECK (breaker_told >= 0);
ALTER TABLE safety ADD COLUMN breaker_pulled_at INTEGER
  CHECK (breaker_pulled_at IS NULL OR breaker_pulled_at >= 0);
`;

/**
 * Gives the install the breaker's mark of its own (decision 0440): `breaker_at`, when the breaker
 * took hold of the install, NULL while it does not; `breaker_version`, the last version of the
 * breaker the install applied, and `breaker_told`, the last one the owner was told of;
 * `breaker_pulled_at`, when the breaker's row turned to pulled for the last hold, as its source
 * said. None touches the owner's `frozen_at`.
 */
export const migration: Migration = {
  name: "0066_breaker_mark",
  up(database) {
    database.exec(sql);
  },
};
