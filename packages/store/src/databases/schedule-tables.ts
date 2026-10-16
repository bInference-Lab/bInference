// The tables of the owner's schedules, as SQLite returns them: migration 0040 defines both.

/** `schedules`: one schedule, with its next run and its last one. */
export interface SchedulesTable {
  id: string;
  agent_id: string;
  when: string;
  prompt: string;
  state: string;
  next_at: number | null;
  zone: string | null;
  last_at: number | null;
  last_due_at: number | null;
  last_outcome: string | null;
  last_reason: string | null;
  last_message_id: string | null;
  created_by: string;
  outside_content: number;
  created_at: number;
  changed_at: number;
}

/** `schedule_runs`: one run of a schedule, sent or skipped with its reason. */
interface ScheduleRunsTable {
  schedule_id: string;
  due_at: number;
  at: number;
  outcome: string;
  reason: string | null;
  message_id: string | null;
}

/** The schedule tables, by name. */
export interface ScheduleTables {
  schedules: SchedulesTable;
  schedule_runs: ScheduleRunsTable;
}
