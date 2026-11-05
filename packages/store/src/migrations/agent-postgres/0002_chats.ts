import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE sessions (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL,
  surface text COLLATE "C" NOT NULL,
  conversation text COLLATE "C" NOT NULL,
  started_at bigint NOT NULL,
  cleared_at bigint,
  summary text COLLATE "C",
  version bigint NOT NULL DEFAULT 0
);

CREATE INDEX sessions_agent_conversation ON sessions (agent_id, conversation);

CREATE TABLE turns (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  session_id text COLLATE "C" NOT NULL REFERENCES sessions (id),
  started_at bigint NOT NULL,
  ended_at bigint,
  outcome text COLLATE "C" CHECK (outcome IN ('ok', 'stopped', 'failed', 'budget', 'loop')),
  committed smallint NOT NULL DEFAULT 0 CHECK (committed IN (0, 1)),
  outside_content smallint NOT NULL DEFAULT 0 CHECK (outside_content IN (0, 1)),
  model text COLLATE "C",
  CHECK ((ended_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX turns_session_started ON turns (session_id, started_at);

CREATE TABLE transcript_events (
  id bigint PRIMARY KEY NOT NULL,
  session_id text COLLATE "C" NOT NULL REFERENCES sessions (id),
  turn_id text COLLATE "C" REFERENCES turns (id),
  seq bigint NOT NULL CHECK (seq >= 1),
  role text COLLATE "C" NOT NULL CHECK (role IN ('owner', 'agent', 'tool', 'system')),
  kind text COLLATE "C" NOT NULL
    CHECK (kind IN ('text', 'tool_call', 'tool_result', 'image', 'summary')),
  content text COLLATE "C" NOT NULL CHECK (content IS JSON),
  at bigint NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE OR REPLACE FUNCTION transcript_events_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('transcript_events', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('transcript_events', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transcript_events_id_next BEFORE INSERT ON transcript_events
  FOR EACH ROW EXECUTE FUNCTION transcript_events_id_next();
`;

/** Creates `sessions`, `turns` and `transcript_events`, as agent 0002 does. */
export const migration: PostgresMigration = { name: "0002_chats", sql };
