import type { Generated } from "kysely";

// The tables of the notice store, as SQLite returns them: migration 0008 defines them, and
// migration 0018 adds `notices.intent_id`.

/** `notices`: one owner notice, its message arguments as JSON, kept 90 days. */
export interface NoticesTable {
  id: string;
  agent_id: string | null;
  kind: string;
  i18n_key: string;
  values: string;
  level: string;
  at: number;
  delivered: string;
  intent_id: string | null;
}

/** `outbox`: one delivery to a surface; `id` counts from 1 in the order deliveries were stored. */
export interface OutboxTable {
  id: Generated<number>;
  surface: string;
  target: string;
  payload: string;
  state: string;
  attempts: number;
  next_at: number | null;
  ref: string | null;
  created_at: number;
  sent_at: number | null;
}

/** The notice store's tables, by name. */
export interface NoticeTables {
  notices: NoticesTable;
  outbox: OutboxTable;
}
