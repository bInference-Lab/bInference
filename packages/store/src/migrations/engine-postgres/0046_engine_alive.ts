import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE engine_alive (
  id bigint PRIMARY KEY CHECK (id = 1),
  alive_at bigint NOT NULL CHECK (alive_at >= 0)
);
INSERT INTO engine_alive (id, alive_at)
VALUES (1, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint);
`;

/** Creates `engine_alive`, the engine's last sign of life, as engine 0046 does. */
export const migration: PostgresMigration = { name: "0046_engine_alive", sql };
