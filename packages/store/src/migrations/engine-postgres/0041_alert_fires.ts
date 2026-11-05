import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The new table first, the
// rows copied, the old one dropped, then renamed, as on SQLite. A condition's fields read
// through jsonb, as SQLite's json_extract reads them.
const sql = `
CREATE TABLE alerts_new (
  id text COLLATE "C" PRIMARY KEY NOT NULL CHECK (id ~ '^alr_'),
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  condition text COLLATE "C" CHECK (condition IS JSON) NOT NULL,
  kind text COLLATE "C" NOT NULL CHECK (kind IN ('price', 'wallet', 'launch')),
  account text COLLATE "C",
  asset text COLLATE "C",
  state text COLLATE "C" NOT NULL CHECK (state IN ('active', 'fired', 'deleted', 'ended')),
  wake smallint NOT NULL DEFAULT 0 CHECK (wake IN (0, 1)),
  fires bigint NOT NULL DEFAULT 0 CHECK (fires >= 0),
  outside_content smallint NOT NULL DEFAULT 0 CHECK (outside_content IN (0, 1)),
  created_by text COLLATE "C" NOT NULL,
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  fired_at bigint,
  expires_at bigint,
  last_message_id text COLLATE "C" CHECK (last_message_id IS NULL OR last_message_id ~ '^msg_'),
  notice_window_at bigint,
  notices_sent bigint NOT NULL DEFAULT 0 CHECK (notices_sent >= 0),
  notices_held bigint NOT NULL DEFAULT 0 CHECK (notices_held >= 0),
  CHECK ((kind = 'wallet') = (account IS NOT NULL)),
  CHECK ((kind = 'price') = (asset IS NOT NULL))
);

INSERT INTO alerts_new (
  id, agent_id, condition, kind, account, asset, state, fires, outside_content, created_by,
  created_at, changed_at, fired_at, expires_at
)
SELECT
  id, agent_id, condition, condition::jsonb #>> '{kind}',
  condition::jsonb #>> '{account}', condition::jsonb #>> '{asset}', state,
  CASE WHEN fired_at IS NULL THEN 0 ELSE 1 END, 1, 'unknown', created_at,
  coalesce(fired_at, created_at), fired_at,
  CASE WHEN condition::jsonb #>> '{kind}' = 'price' THEN NULL ELSE created_at + 2592000000 END
FROM alerts;

DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
ALTER INDEX alerts_new_pkey RENAME TO alerts_pkey;

CREATE INDEX alerts_state_agent ON alerts (state, agent_id);
CREATE INDEX alerts_state_expires ON alerts (state, expires_at);
CREATE INDEX alerts_state_account ON alerts (state, account);
CREATE INDEX alerts_state_asset ON alerts (state, asset);

CREATE TABLE alert_fires (
  alert_id text COLLATE "C" NOT NULL REFERENCES alerts (id),
  fires bigint NOT NULL CHECK (fires >= 1),
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  at bigint NOT NULL,
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('woke', 'replaced', 'skipped', 'quiet')),
  reason text COLLATE "C" CHECK (
    reason IS NULL OR reason IN ('frozen', 'archived', 'budget', 'hourly', 'busy')
  ),
  message_id text COLLATE "C" CHECK (message_id IS NULL OR message_id ~ '^msg_'),
  CHECK ((outcome = 'skipped') = (reason IS NOT NULL)),
  CHECK ((outcome IN ('woke', 'replaced')) = (message_id IS NOT NULL)),
  PRIMARY KEY (alert_id, fires)
);

CREATE INDEX alert_fires_agent_at ON alert_fires (agent_id, at);
`;

/**
 * Makes `alerts` again with its kind, wake-ups and notice window, and creates `alert_fires`, as
 * engine 0041 does.
 */
export const migration: PostgresMigration = { name: "0041_alert_fires", sql };
