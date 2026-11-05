import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
UPDATE limits SET pending = (pending::jsonb - 'min_health_factor_bp')::text
WHERE pending IS NOT NULL;
ALTER TABLE limits DROP COLUMN min_health_factor_bp;
`;

/**
 * Drops `limits.min_health_factor_bp`, from the looser limits that wait too, as engine 0050 does.
 */
export const migration: PostgresMigration = { name: "0050_limits_without_health_factor", sql };
