import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The trigger sets each new
// allowed command's write-order number from the counter in the insert's own transaction, whatever
// the insert wrote.
const sql = `
CREATE TABLE shell_allowed (
  id text COLLATE "C" PRIMARY KEY NOT NULL CHECK (id ~ '^sac_'),
  seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0),
  text text COLLATE "C" NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
  program text COLLATE "C" NOT NULL CHECK (length(program) BETWEEN 1 AND 4096),
  args text COLLATE "C" NOT NULL CHECK (jsonb_typeof(args::jsonb) = 'array'),
  folder text COLLATE "C" NOT NULL CHECK (length(folder) BETWEEN 1 AND 4096),
  allowed_at bigint NOT NULL CHECK (allowed_at >= 0),
  UNIQUE (program, args, folder)
);

INSERT INTO counters AS c (name, last) VALUES ('shell_allowed', 0)
  ON CONFLICT (name) DO NOTHING;

CREATE UNIQUE INDEX shell_allowed_seq ON shell_allowed (seq);

CREATE FUNCTION shell_allowed_seq_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO counters AS c (name, last) VALUES ('shell_allowed', 1)
    ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.seq;
  RETURN NEW;
END $$;

CREATE TRIGGER shell_allowed_seq_next BEFORE INSERT ON shell_allowed
  FOR EACH ROW EXECUTE FUNCTION shell_allowed_seq_next();

CREATE TABLE shell_watches (
  job text COLLATE "C" PRIMARY KEY NOT NULL CHECK (job ~ '^shj_'),
  agent_id text COLLATE "C" NOT NULL CHECK (agent_id ~ '^agt_'),
  command text COLLATE "C" NOT NULL CHECK (length(command) BETWEEN 1 AND 8000),
  folder text COLLATE "C" NOT NULL CHECK (length(folder) BETWEEN 1 AND 4096),
  started_at bigint NOT NULL CHECK (started_at >= 0),
  surface text COLLATE "C" NOT NULL CHECK (surface IN ('telegram', 'console', 'cli', 'mini'))
);
`;

/** Makes `shell_allowed` and `shell_watches`, the shell's rows, as engine 0064 does. */
export const migration: PostgresMigration = { name: "0064_shell_rows", sql };
