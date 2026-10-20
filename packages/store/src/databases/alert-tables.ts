// The tables of the agents' alerts, as SQLite returns them: migration 0041 defines both.

/** `alerts`: one alert, with its condition, its fires and when it ends. */
export interface AlertsTable {
  id: string;
  agent_id: string;
  condition: string;
  kind: string;
  account: string | null;
  asset: string | null;
  state: string;
  wake: number;
  fires: number;
  outside_content: number;
  created_by: string;
  created_at: number;
  changed_at: number;
  fired_at: number | null;
  expires_at: number | null;
  last_message_id: string | null;
  notice_window_at: number | null;
  notices_sent: number;
  notices_held: number;
}

/** `alert_fires`: one fire of an alert, and what it did about its wake-up. */
interface AlertFiresTable {
  alert_id: string;
  fires: number;
  agent_id: string;
  at: number;
  outcome: string;
  reason: string | null;
  message_id: string | null;
  /** 1 once a notice told this wake-up, which the hourly limit held back. */
  told: number;
}

/** The alert tables, by name. */
export interface AlertTables {
  alerts: AlertsTable;
  alert_fires: AlertFiresTable;
}
