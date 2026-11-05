import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE late_landings (
  intent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES intents (id),
  tx_id text COLLATE "C" NOT NULL,
  at bigint NOT NULL
);
`;

/**
 * Creates `late_landings`, a transaction found in a block after its intent ended, as engine 0020
 * does.
 */
export const migration: PostgresMigration = { name: "0020_late_landings", sql };
