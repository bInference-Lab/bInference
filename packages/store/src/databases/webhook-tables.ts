// The webhook rules' tables, as SQLite returns them: migrations 0005 and 0057 define them.
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
}

/** `webhook_events`: each alert a rule's URL took, with what became of it. */
interface WebhookEventsTable {
  id: Generated<number>;
  rule_id: string;
  alert_id: string | null;
  body_hash: string;
  received_at: number;
  outcome: string;
  intent_id: string | null;
}

/** The webhook rules' tables, by name. */
export interface WebhookTables {
  webhook_rules: WebhookRulesTable;
  webhook_events: WebhookEventsTable;
}
