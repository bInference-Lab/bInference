// The webhook rules' tables, as SQLite returns them: migrations 0005, 0057 and 0059 define them.
import type { Generated } from "kysely";

/** `webhook_rules`: each rule, its secret's SHA-256 and its bounds as `action` JSON text. */
export interface WebhookRulesTable {
  id: string;
  agent_id: string;
  name: string;
  secret_hash: string;
  action: string;
  state: string;
  rate_per_min: number;
  last_alert_at: number | null;
  fills: Generated<number>;
  max_fills: number | null;
  expires_at: number | null;
  card_id: string | null;
  created_at: number;
  changed_at: number;
  version: Generated<number>;
  wallet_id: string | null;
  intent_id: string | null;
  paper: Generated<number>;
  url_changed_at: number | null;
  old_url_last_event: Generated<number>;
  notice_window_at: number | null;
  notices_sent: Generated<number>;
  notices_held: Generated<number>;
}

/** `webhook_events`: each alert a rule's URL took, with what became of it. */
export interface WebhookEventsTable {
  id: Generated<number>;
  rule_id: string;
  alert_id: string | null;
  body_hash: string;
  received_at: number;
  outcome: string;
  intent_id: string | null;
  engine_locked: Generated<number>;
  fill_outcome: string | null;
  fill_reason: string | null;
  notices: string | null;
  announced_at: number | null;
}

/** The webhook rules' tables, by name. */
export interface WebhookTables {
  webhook_rules: WebhookRulesTable;
  webhook_events: WebhookEventsTable;
}
