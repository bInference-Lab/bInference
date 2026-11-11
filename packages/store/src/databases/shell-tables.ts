import type { Generated } from "kysely";

// The shell's tables, as SQLite returns them: migration 0064 defines them.

/** `shell_allowed`: one command the owner allowed always, its arguments as JSON text. */
interface ShellAllowedTable {
  id: string;
  seq: Generated<number>;
  text: string;
  program: string;
  args: string;
  folder: string;
  allowed_at: number;
}

/** `shell_watches`: one command whose end its agent is still to hear. */
interface ShellWatchTable {
  job: string;
  agent_id: string;
  command: string;
  folder: string;
  started_at: number;
  surface: string;
}

/** The shell's tables, by name. */
export interface ShellTables {
  shell_allowed: ShellAllowedTable;
  shell_watches: ShellWatchTable;
}
