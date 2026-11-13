import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE safety ADD COLUMN breaker_at bigint CHECK (breaker_at IS NULL OR breaker_at >= 0);
ALTER TABLE safety ADD COLUMN breaker_version bigint NOT NULL DEFAULT 0
  CHECK (breaker_version >= 0);
ALTER TABLE safety ADD COLUMN breaker_told bigint NOT NULL DEFAULT 0
  CHECK (breaker_told >= 0);
ALTER TABLE safety ADD COLUMN breaker_pulled_at bigint
  CHECK (breaker_pulled_at IS NULL OR breaker_pulled_at >= 0);
`;

/**
 * Gives the install the breaker's mark of its own (decision 0440): `breaker_at`,
 * `breaker_version`, `breaker_told` and `breaker_pulled_at`, apart from the owner's `frozen_at`.
 */
export const migration: PostgresMigration = { name: "0066_breaker_mark", sql };
