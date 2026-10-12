// The tables of the agent inbox and the agent's questions, as SQLite returns them: migration 0028
// defines `agent_inbox`, with `agents.chat_session_id`, and migration 0035 the questions.

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

/** `questions`: one question of the agent to the owner (migration 0035). */
export interface QuestionsTable {
  id: string;
  agent_id: string;
  session_id: string;
  turn_id: string;
  text: string;
  choices: string;
  ref: string;
  state: string;
  answer: string | null;
  close_reason: string | null;
  created_at: number;
  closes_at: number;
  closed_at: number | null;
}

/** `question_messages`: one surface's copy of a question. */
interface QuestionMessagesTable {
  question_id: string;
  surface: string;
  chat_id: number;
  topic_id: number | null;
  message_id: number;
  sent_at: number;
}

/** The agent inbox's tables and the agent's questions, by name. */
export interface AgentInboxTables {
  agent_inbox: AgentInboxTable;
  questions: QuestionsTable;
  question_messages: QuestionMessagesTable;
}
