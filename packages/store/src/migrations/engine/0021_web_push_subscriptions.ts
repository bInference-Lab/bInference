import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. One row per endpoint; a
// device's rows go when the device is revoked, so the device column is indexed.
const sql = `
CREATE TABLE web_push_subscriptions (
  endpoint TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices (id),
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  server_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX web_push_subscriptions_device ON web_push_subscriptions (device_id);
`;

/**
 * Creates `web_push_subscriptions`: each console device's browser push subscriptions, with the
 * VAPID public key the browser subscribed with (decision 0158). The VAPID private key is never
 * here.
 */
export const migration: Migration = {
  name: "0021_web_push_subscriptions",
  up(database) {
    database.exec(sql);
  },
};
