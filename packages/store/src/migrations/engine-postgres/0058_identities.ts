import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
DROP TABLE identities;

CREATE TABLE identities (
  agent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES agents (id),
  chain text COLLATE "C" NOT NULL CHECK (length(chain) BETWEEN 1 AND 200),
  registry text COLLATE "C" NOT NULL CHECK (length(registry) BETWEEN 1 AND 200),
  onchain_id numeric(78,0) NOT NULL CHECK (onchain_id >= 0),
  tx_hash text COLLATE "C" NOT NULL CHECK (length(tx_hash) BETWEEN 1 AND 128),
  registered_at bigint NOT NULL,
  file text COLLATE "C" NOT NULL CHECK (file ~ '^data:' AND length(file) <= 16384)
);
`;

/** Makes `identities` again with the registration file, as engine 0058 does. */
export const migration: PostgresMigration = { name: "0058_identities", sql };
