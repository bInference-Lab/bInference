import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The transcript is
// append-only: a change of an event always fails, and so does a removal, except of an event
// older than `meta.prune_before`, which only the retention task sets, inside its own
// transaction. The trigram index of agent 0003 already finds a word inside Chinese text.
const sql = `
ALTER TABLE turns ADD COLUMN held_back bigint NOT NULL DEFAULT 0 CHECK (held_back >= 0);

ALTER TABLE transcript_events ADD COLUMN outside smallint NOT NULL DEFAULT 0 CHECK (
  outside IN (0, 1)
);

CREATE FUNCTION transcript_events_refuse_changes() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION 'the transcript is append-only';
END $$;

CREATE TRIGGER transcript_events_refuse_changes BEFORE UPDATE ON transcript_events
  FOR EACH ROW EXECUTE FUNCTION transcript_events_refuse_changes();

CREATE FUNCTION transcript_events_refuse_removal() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD.at >= coalesce((SELECT value::bigint FROM meta WHERE key = 'prune_before'), 0) THEN
    RAISE EXCEPTION 'the transcript is append-only';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER transcript_events_refuse_removal BEFORE DELETE ON transcript_events
  FOR EACH ROW EXECUTE FUNCTION transcript_events_refuse_removal();

CREATE TABLE chat_queue (
  message text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL,
  session_id text COLLATE "C" NOT NULL,
  kind text COLLATE "C" NOT NULL CHECK (kind IN (
    'inbox/message', 'inbox/intentSettled', 'inbox/orderSettled', 'inbox/scheduleDue',
    'inbox/alertFired', 'inbox/resumeReport', 'inbox/stop', 'inbox/clear'
  )),
  payload text COLLATE "C" NOT NULL CHECK (payload IS JSON),
  received_at bigint NOT NULL,
  turn_id text COLLATE "C",
  dropped_at bigint,
  drop_reason text COLLATE "C"
    CHECK (drop_reason IS NULL OR length(drop_reason) BETWEEN 1 AND 64),
  CHECK ((dropped_at IS NULL) = (drop_reason IS NULL)),
  CHECK (turn_id IS NULL OR dropped_at IS NULL)
);

CREATE INDEX chat_queue_session_received ON chat_queue (session_id, received_at);
`;

/**
 * Adds what the agent runtime keeps of a chat: held-back turns, outside events, the append-only
 * transcript and `chat_queue`, as agent 0004 does.
 */
export const migration: PostgresMigration = { name: "0004_runtime_chats", sql };
