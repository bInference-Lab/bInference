import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Migration 0003 made
// `identities` without the registration file, and no release ever wrote a row of it, so the
// table is made again whole. An id is a decimal string of at most 78 digits, with no sign and no
// leading zero; a file is a data URI.
const sql = `
DROP TABLE identities;

CREATE TABLE identities (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents (id),
  chain TEXT NOT NULL CHECK (length(chain) BETWEEN 1 AND 200),
  registry TEXT NOT NULL CHECK (length(registry) BETWEEN 1 AND 200),
  onchain_id TEXT NOT NULL CHECK (onchain_id != '' AND onchain_id NOT GLOB '*[^0-9]*' AND (onchain_id = '0' OR onchain_id NOT GLOB '0*') AND length(onchain_id) <= 78),
  tx_hash TEXT NOT NULL CHECK (length(tx_hash) BETWEEN 1 AND 128),
  registered_at INTEGER NOT NULL,
  file TEXT NOT NULL CHECK (file GLOB 'data:*' AND length(file) <= 16384)
) STRICT;
`;

/**
 * Makes `identities` again with its registration file (decision 0335): an agent's one identity in
 * a chain's identity registry, with the registry, the id it gave, the transaction that registered
 * it, when that landed, and the registration file as the transaction stored it. Its
 * `registerIdentity` intent writes it with its move to `reconciled`, once the registry read it
 * back.
 */
export const migration: Migration = {
  name: "0058_identities",
  up(database) {
    database.exec(sql);
  },
};
