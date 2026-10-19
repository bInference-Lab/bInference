import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot widen a
// CHECK or add a required column in place, so `alerts` is made again: the new table first, the
// rows copied, the old one dropped, then renamed, in the migration's one transaction. No release
// wrote an alert before; a row that exists anyway keeps its fields, wakes no one, counts as set by
// an outside client, and ends 30 days after it was made unless it is a price alert.
const json = (column: string): string => `${column} TEXT CHECK (json_valid(${column}))`;
const flag = (column: string): string =>
  `${column} INTEGER NOT NULL DEFAULT 0 CHECK (${column} IN (0, 1))`;
const skips = "'frozen', 'archived', 'budget', 'hourly', 'busy'";

const sql = `
CREATE TABLE alerts_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'alr_*'),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  ${json("condition")} NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('price', 'wallet', 'launch')),
  account TEXT,
  asset TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'fired', 'deleted', 'ended')),
  ${flag("wake")},
  fires INTEGER NOT NULL DEFAULT 0 CHECK (fires >= 0),
  ${flag("outside_content")},
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  fired_at INTEGER,
  expires_at INTEGER,
  last_message_id TEXT CHECK (last_message_id IS NULL OR last_message_id GLOB 'msg_*'),
  notice_window_at INTEGER,
  notices_sent INTEGER NOT NULL DEFAULT 0 CHECK (notices_sent >= 0),
  notices_held INTEGER NOT NULL DEFAULT 0 CHECK (notices_held >= 0),
  CHECK ((kind = 'wallet') = (account IS NOT NULL)),
  CHECK ((kind = 'price') = (asset IS NOT NULL))
) STRICT;

INSERT INTO alerts_new (
  id, agent_id, condition, kind, account, asset, state, fires, outside_content, created_by,
  created_at, changed_at, fired_at, expires_at
)
SELECT
  id, agent_id, condition, json_extract(condition, '$.kind'),
  json_extract(condition, '$.account'), json_extract(condition, '$.asset'), state,
  CASE WHEN fired_at IS NULL THEN 0 ELSE 1 END, 1, 'unknown', created_at,
  coalesce(fired_at, created_at), fired_at,
  CASE WHEN json_extract(condition, '$.kind') = 'price' THEN NULL ELSE created_at + 2592000000 END
FROM alerts;

DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;

CREATE INDEX alerts_state_agent ON alerts (state, agent_id);
CREATE INDEX alerts_state_expires ON alerts (state, expires_at);
CREATE INDEX alerts_state_account ON alerts (state, account);
CREATE INDEX alerts_state_asset ON alerts (state, asset);

CREATE TABLE alert_fires (
  alert_id TEXT NOT NULL REFERENCES alerts (id),
  fires INTEGER NOT NULL CHECK (fires >= 1),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('woke', 'replaced', 'skipped', 'quiet')),
  reason TEXT CHECK (reason IS NULL OR reason IN (${skips})),
  message_id TEXT CHECK (message_id IS NULL OR message_id GLOB 'msg_*'),
  CHECK ((outcome = 'skipped') = (reason IS NOT NULL)),
  CHECK ((outcome IN ('woke', 'replaced')) = (message_id IS NOT NULL)),
  PRIMARY KEY (alert_id, fires)
) STRICT;

CREATE INDEX alert_fires_agent_at ON alert_fires (agent_id, at);
`;

/**
 * Makes `alerts` again with the kind, account and asset of its condition, whether it wakes the
 * agent, how many times it fired, the outside-content mark, who set it, when it ends, its last
 * wake-up, its notice hour and the `ended` state; and creates `alert_fires`, one row per fire with what it did about its
 * wake-up, which the hourly limit on wake-ups reads (protocol spec, section 8.4).
 */
export const migration: Migration = {
  name: "0041_alert_fires",
  up(database) {
    database.exec(sql);
  },
};
