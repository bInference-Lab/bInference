import type { Generated, Selectable } from "kysely";

// The agent database's tables as SQLite returns them: TEXT is a string, INTEGER a number, and a
// nullable column may be null. The migrations in src/migrations/agent/ define them.

/** `meta`: the schema version, the writer fence and retention's cutoff. */
interface AgentMetaTable {
  key: string;
  value: string;
}

/** `sessions`. */
interface SessionsTable {
  id: string;
  agent_id: string;
  surface: string;
  conversation: string;
  started_at: number;
  cleared_at: number | null;
  summary: string | null;
  version: Generated<number>;
}

/** `turns`: flags as 0 or 1. */
export interface TurnsTable {
  id: string;
  session_id: string;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  committed: Generated<number>;
  outside_content: Generated<number>;
  held_back: Generated<number>;
  model: string | null;
}

/** `transcript_events`: content as JSON text. */
export interface TranscriptEventsTable {
  id: Generated<number>;
  session_id: string;
  turn_id: string | null;
  seq: number;
  role: string;
  kind: string;
  content: string;
  at: number;
  outside: Generated<number>;
}

/** `chat_queue`: the payload as JSON text. */
interface ChatQueueTable {
  message: string;
  agent_id: string;
  session_id: string;
  kind: string;
  payload: string;
  received_at: number;
  turn_id: string | null;
  dropped_at: number | null;
  drop_reason: string | null;
}

/** `notes`; `notes_fts` indexes its text. */
interface NotesTable {
  id: Generated<number>;
  agent_id: string;
  text: string;
  origin: string;
  created_at: number;
  changed_at: number;
  deleted_at: number | null;
}

/** The FTS5 index over `notes.text`: `notes_fts` is the column a `match` names, `rank` its order. */
interface NotesFtsTable {
  rowid: number;
  text: string;
  notes_fts: string;
  rank: number;
}

/** Every table of `agent.sqlite` the store adapters query. */
export interface AgentTables {
  meta: AgentMetaTable;
  sessions: SessionsTable;
  turns: TurnsTable;
  transcript_events: TranscriptEventsTable;
  chat_queue: ChatQueueTable;
  notes: NotesTable;
  notes_fts: NotesFtsTable;
}

/** A `sessions` row as a query reads it. */
export type SessionRow = Selectable<SessionsTable>;

/** A `chat_queue` row as a query reads it. */
export type QueueRow = Selectable<ChatQueueTable>;

/** A `notes` row as a query reads it. */
export type NoteRow = Selectable<NotesTable>;
