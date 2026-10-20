// The table of the engine's last run, as SQLite returns it: migration 0046 defines `engine_alive`.

/** `engine_alive`: one row, `id = 1`, when the engine last ran. */
interface EngineAliveTable {
  id: number;
  alive_at: number;
}

/** The tables of the engine's downtime, by name. */
export interface DowntimeTables {
  engine_alive: EngineAliveTable;
}
