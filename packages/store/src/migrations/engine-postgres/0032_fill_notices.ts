import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE order_fills ADD COLUMN notices text COLLATE "C" CHECK (notices IS JSON);
ALTER TABLE order_fills ADD COLUMN announced_at bigint;

CREATE INDEX order_fills_unannounced ON order_fills (at)
  WHERE notices IS NOT NULL AND announced_at IS NULL;
`;

/**
 * Adds the notices a fill announces, `order_fills.notices` and `order_fills.announced_at`, as
 * engine 0032 does.
 */
export const migration: PostgresMigration = { name: "0032_fill_notices", sql };
