import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE web_push_subscriptions (
  endpoint text COLLATE "C" PRIMARY KEY NOT NULL,
  device_id text COLLATE "C" NOT NULL REFERENCES devices (id),
  p256dh text COLLATE "C" NOT NULL,
  auth text COLLATE "C" NOT NULL,
  server_key text COLLATE "C" NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX web_push_subscriptions_device ON web_push_subscriptions (device_id);
`;

/** Creates `web_push_subscriptions`, one row per endpoint, as engine 0021 does. */
export const migration: PostgresMigration = { name: "0021_web_push_subscriptions", sql };
