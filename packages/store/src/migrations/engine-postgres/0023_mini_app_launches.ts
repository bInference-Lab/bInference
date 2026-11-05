import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE mini_app_launches (
  launch_hash text COLLATE "C" PRIMARY KEY NOT NULL CHECK (
    length(launch_hash) = 64 AND launch_hash !~ '[^0-9a-f]'
  ),
  seen_at bigint NOT NULL
);

CREATE INDEX mini_app_launches_seen_at ON mini_app_launches (seen_at);
`;

/** Creates `mini_app_launches`, the hash of each Mini App launch seen, as engine 0023 does. */
export const migration: PostgresMigration = { name: "0023_mini_app_launches", sql };
