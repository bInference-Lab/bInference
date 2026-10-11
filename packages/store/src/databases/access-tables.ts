// The access tables of `engine.sqlite`, as SQLite returns them: migration 0009 defines them,
// migration 0021 adds `web_push_subscriptions`, migration 0023 `mini_app_launches` and migration
// 0024 `mini_app_tickets`.

/** `tokens`. */
export interface TokensTable {
  id: string;
  label: string;
  kind: string;
  scopes: string;
  secret_hash: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  expires_at: number | null;
}

/** `devices`. */
export interface DevicesTable {
  id: string;
  label: string;
  alg: string;
  public_key: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

/** `pair_codes`. */
interface PairCodesTable {
  code_hash: string;
  expires_at: number;
  used_at: number | null;
}

/** `web_push_subscriptions`: a console device's browser push subscriptions (decision 0158). */
export interface WebPushSubscriptionsTable {
  endpoint: string;
  device_id: string;
  p256dh: string;
  auth: string;
  server_key: string;
  created_at: number;
}

/** `mini_app_launches`: the SHA-256 of each Mini App launch that signed in (decision 0160). */
interface MiniAppLaunchesTable {
  launch_hash: string;
  seen_at: number;
}

/** `mini_app_tickets`: the SHA-256 of each launch ticket `/console` made (decision 0161). */
interface MiniAppTicketsTable {
  ticket_hash: string;
  user_id: number;
  issued_at: number;
  expires_at: number;
}

/** The access tables, by name. */
export interface AccessTables {
  tokens: TokensTable;
  devices: DevicesTable;
  pair_codes: PairCodesTable;
  web_push_subscriptions: WebPushSubscriptionsTable;
  mini_app_launches: MiniAppLaunchesTable;
  mini_app_tickets: MiniAppTicketsTable;
}
