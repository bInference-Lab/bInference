import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
INSERT INTO send_levels (agent_id, level, pending_level, pending_at, changed_at, version)
SELECT id, 3, NULL, NULL, created_at, 0
FROM agents
WHERE id NOT IN (SELECT agent_id FROM send_levels);
`;

/** Gives every agent stored before a `send_levels` row at level 3, as engine 0011 does. */
export const migration: PostgresMigration = { name: "0011_send_level_rows", sql };
