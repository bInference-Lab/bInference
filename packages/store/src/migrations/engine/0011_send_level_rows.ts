import type { Migration } from "../migration.js";

// Before this migration no code wrote `send_levels`, and the policy read every agent at level 3,
// so an agent made earlier keeps level 3: its sends stay refused until the owner loosens it.
const sql = `
INSERT INTO send_levels (agent_id, level, pending_level, pending_at, changed_at, version)
SELECT id, 3, NULL, NULL, created_at, 0
FROM agents
WHERE id NOT IN (SELECT agent_id FROM send_levels);
`;

/** Gives every agent made before send levels were stored its `send_levels` row, at level 3. */
export const migration: Migration = {
  name: "0011_send_level_rows",
  up(database) {
    database.exec(sql);
  },
};
