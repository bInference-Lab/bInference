import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A rebuild adopts every
// launch wallet the owner key owns, so one agent may hold more than one live launch wallet; the
// engine refuses a second one made with `wallet/create`.
const sql = `
DROP INDEX wallets_one_launch_per_agent;
`;

/**
 * Drops the index that held one live launch wallet per agent (decision 0218): a rebuild keeps
 * every launch wallet it finds, the first the agent's launch wallet and the others extra ones the
 * owner rescues.
 */
export const migration: Migration = {
  name: "0039_extra_launch_wallets",
  up(database) {
    database.exec(sql);
  },
};
