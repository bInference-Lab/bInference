import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. An allowed command's
// arguments are a JSON array of strings; its trigger takes each new row's write-order number from
// the counter in the insert's own transaction, after the insert wrote 0.
const sql = `
CREATE TABLE shell_allowed (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'sac_*'),
  seq INTEGER NOT NULL DEFAULT 0 CHECK (seq >= 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
  program TEXT NOT NULL CHECK (length(program) BETWEEN 1 AND 4096),
  args TEXT NOT NULL CHECK (json_valid(args) AND json_type(args) = 'array'),
  folder TEXT NOT NULL CHECK (length(folder) BETWEEN 1 AND 4096),
  allowed_at INTEGER NOT NULL CHECK (allowed_at >= 0),
  UNIQUE (program, args, folder)
) STRICT;

INSERT INTO counters (name, last) VALUES ('shell_allowed', 0);

CREATE UNIQUE INDEX shell_allowed_seq ON shell_allowed (seq);

CREATE TRIGGER shell_allowed_seq_next AFTER INSERT ON shell_allowed
BEGIN
  UPDATE counters SET last = last + 1 WHERE name = 'shell_allowed';
  UPDATE shell_allowed SET seq = (SELECT last FROM counters WHERE name = 'shell_allowed')
  WHERE rowid = NEW.rowid;
END;

CREATE TABLE shell_watches (
  job TEXT PRIMARY KEY NOT NULL CHECK (job GLOB 'shj_*'),
  agent_id TEXT NOT NULL CHECK (agent_id GLOB 'agt_*'),
  command TEXT NOT NULL CHECK (length(command) BETWEEN 1 AND 8000),
  folder TEXT NOT NULL CHECK (length(folder) BETWEEN 1 AND 4096),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  surface TEXT NOT NULL CHECK (surface IN ('telegram', 'console', 'cli', 'mini'))
) STRICT;
`;

/**
 * Makes the shell's rows (decision 0409): `shell_allowed`, each command the owner allowed always,
 * one per program, arguments and folder, numbered in the order they were kept; and
 * `shell_watches`, each command the agent left running whose end it is still to hear, so one a
 * restart lost is told at the next start.
 */
export const migration: Migration = {
  name: "0064_shell_rows",
  up(database) {
    database.exec(sql);
  },
};
