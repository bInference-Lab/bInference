// The table of the agent inbox, as SQLite returns it: migration 0028 defines it, with
// `agents.chat_session_id`.

/** `agent_inbox`: one message for the agent runtime, kept until it is taken. */
export interface AgentInboxTable {
  id: string;
  agent_id: string;
  session_id: string;
  kind: string;
  turn_id: string | null;
  payload: string;
  created_at: number;
  taken_at: number | null;
}

/** The agent inbox's tables, by name. */
export interface AgentInboxTables {
  agent_inbox: AgentInboxTable;
}
