import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. `counters` comes here,
// before any table with a write-order key: on Postgres every such key takes its next value from
// its counter row (decision 0366), where SQLite numbers rows itself until engine 0060.
const sql = `
CREATE TABLE meta (
  key text COLLATE "C" PRIMARY KEY NOT NULL,
  value text COLLATE "C" NOT NULL
);

CREATE TABLE counters (
  name text COLLATE "C" PRIMARY KEY NOT NULL,
  last bigint NOT NULL CHECK (last >= 0)
);
`;

/** Creates `meta` and `counters` in the engine schema. */
export const migration: PostgresMigration = { name: "0001_meta", sql };
