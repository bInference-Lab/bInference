// The daily summaries' table, as SQLite returns it: migration 0047 defines it.

/** `daily_summaries`: an agent's summary of one owner's date, with the totals it read. */
interface DailySummariesTable {
  agent_id: string;
  date: string;
  at: number;
  outcome: string;
  live_usd_micros: string | null;
  paper_usd_micros: string | null;
}

/** The daily summaries' table, by name. */
export interface SummaryTables {
  daily_summaries: DailySummariesTable;
}
