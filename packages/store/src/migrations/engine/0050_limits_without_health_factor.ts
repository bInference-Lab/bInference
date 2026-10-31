import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. The looser limits that
// wait hold every limit column as JSON, so the health factor leaves them too.
const sql = `
UPDATE limits SET pending = json_remove(pending, '$.min_health_factor_bp') WHERE pending IS NOT NULL;
ALTER TABLE limits DROP COLUMN min_health_factor_bp;
`;

/**
 * Drops `limits.min_health_factor_bp`, from the limits in effect and from the looser ones that
 * wait: binference does not lend or borrow, so no limit holds a health factor (decision 0296).
 */
export const migration: Migration = {
  name: "0050_limits_without_health_factor",
  up(database) {
    database.exec(sql);
  },
};
