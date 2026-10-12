import type { DatabaseSync } from "node:sqlite";
import { err, idSchema, ok, type Result } from "@binference/core";
import {
  type AgentInboxMessage,
  agentInboxMessageSchema,
  isAnswerable,
  maxUntakenMessages,
  type QuestionAnswerDraft,
  questionAnswerDraftSchema,
  type QuestionClosing,
  questionClosingSchema,
  type QuestionCopy,
  questionCopySchema,
  type QuestionRecord,
  questionRecordSchema,
  questionRefSchema,
} from "@binference/engine/chat";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { QuestionsTable } from "../databases/agent-inbox-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonField, jsonText, readJson } from "../rows/column-values.js";
import { changedRows } from "../tasks/count-schema.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { insertMessage, sessionFor, untakenCount } from "./agent-inbox-writes.js";

/** Reads one `questions` row as its record. */
function toQuestion(row: Selectable<QuestionsTable>): QuestionRecord {
  return questionRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    text: row.text,
    choices: readJson(row.choices),
    ref: row.ref,
    state: row.state,
    ...jsonField("answer", row.answer),
    ...field("closeReason", row.close_reason),
    createdAtMs: row.created_at,
    closesAtMs: row.closes_at,
    ...field("closedAtMs", row.closed_at),
  });
}

function selectQuestions(database: DatabaseSync) {
  const sync = createSyncKysely<EngineTables>(database);
  return { sync, query: sync.kysely.selectFrom("questions").selectAll() };
}

function questionWhere(
  database: DatabaseSync,
  column: "id" | "ref",
  value: string,
): QuestionRecord | undefined {
  const { sync, query } = selectQuestions(database);
  const row = sync.takeFirst(query.where(column, "=", value));
  return row === undefined ? undefined : toQuestion(row);
}

function openOf(database: DatabaseSync, agent: string): QuestionRecord | undefined {
  const { sync, query } = selectQuestions(database);
  const row = sync.takeFirst(query.where("agent_id", "=", agent).where("state", "=", "open"));
  return row === undefined ? undefined : toQuestion(row);
}

// Closes a question that is open now, and reads it back; `undefined` when it is not.
function closeOpen(
  database: DatabaseSync,
  closing: { readonly id: string; readonly reason: string; readonly atMs: number },
): QuestionRecord | undefined {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const changed = execute(
    kysely
      .updateTable("questions")
      .set({ state: "closed", close_reason: closing.reason, closed_at: closing.atMs })
      .where("id", "=", closing.id)
      .where("state", "=", "open"),
  );
  return changedRows(changed) === 0 ? undefined : questionWhere(database, "id", closing.id);
}

const askedSchema = z.object({
  asked: questionRecordSchema,
  closed: questionRecordSchema.exactOptional(),
});

/**
 * Stores a new open question, closing the agent's open one first: `expired` once it is 24 hours
 * old at the new one's time, else `replaced`. An id or reference in use fails its constraint.
 */
export const askQuestionTask: StoreTask<
  QuestionRecord,
  { readonly asked: QuestionRecord; readonly closed?: QuestionRecord }
> = defineTask({
  name: "questions.ask",
  access: "write",
  input: questionRecordSchema,
  output: askedSchema,
  run(database, question) {
    const open = openOf(database, question.agentId);
    const reason =
      open !== undefined && question.createdAtMs >= open.closesAtMs ? "expired" : "replaced";
    const closed =
      open === undefined
        ? undefined
        : closeOpen(database, { id: open.id, reason, atMs: question.createdAtMs });
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely.insertInto("questions").values({
        id: question.id,
        agent_id: question.agentId,
        session_id: question.sessionId,
        turn_id: question.turnId,
        text: question.text,
        choices: jsonText(question.choices),
        ref: question.ref,
        state: question.state,
        answer: null,
        close_reason: null,
        created_at: question.createdAtMs,
        closes_at: question.closesAtMs,
        closed_at: null,
      }),
    );
    return { asked: question, ...(closed === undefined ? {} : { closed }) };
  },
});

/** One question by its id. */
export const getQuestionTask: StoreTask<string, QuestionRecord | undefined> = defineTask({
  name: "questions.get",
  access: "read",
  input: idSchema("qst"),
  output: questionRecordSchema.optional(),
  run: (database, id) => questionWhere(database, "id", id),
});

/** The question whose buttons carry a reference. */
export const questionByRefTask: StoreTask<string, QuestionRecord | undefined> = defineTask({
  name: "questions.byRef",
  access: "read",
  input: questionRefSchema,
  output: questionRecordSchema.optional(),
  run: (database, ref) => questionWhere(database, "ref", ref),
});

/** The agent's open question. */
export const openQuestionTask: StoreTask<string, QuestionRecord | undefined> = defineTask({
  name: "questions.openOf",
  access: "read",
  input: idSchema("agt"),
  output: questionRecordSchema.optional(),
  run: (database, agent) => openOf(database, agent),
});

const answeredSchema = resultSchema(
  z.object({ question: questionRecordSchema, message: agentInboxMessageSchema }),
  ["closed", "not_found", "busy"],
);

/**
 * Answers an open question that has not expired and stores its `inbox/message` in the agent's
 * open session, in one transaction.
 */
export const answerQuestionTask: StoreTask<
  QuestionAnswerDraft,
  Result<
    { readonly question: QuestionRecord; readonly message: AgentInboxMessage },
    "closed" | "not_found" | "busy"
  >
> = defineTask({
  name: "questions.answer",
  access: "write",
  input: questionAnswerDraftSchema,
  output: answeredSchema,
  run(database, draft) {
    const question = questionWhere(database, "id", draft.questionId);
    if (question === undefined) {
      return err("not_found");
    }
    const { answer, message } = draft;
    if (!isAnswerable(question, answer.atMs)) {
      return err("closed");
    }
    if (untakenCount(database, question.agentId) >= maxUntakenMessages) {
      return err("busy");
    }
    const sessionId = sessionFor(database, question.agentId, message.opens) ?? message.opens;
    const stored = insertMessage(database, {
      id: message.id,
      agentId: question.agentId,
      sessionId,
      kind: "inbox/message",
      turnId: message.turnId,
      payload: message.payload,
      createdAtMs: answer.atMs,
    });
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("questions")
        .set({ state: "answered", answer: jsonText({ ...answer }), closed_at: answer.atMs })
        .where("id", "=", question.id),
    );
    const answered = questionWhere(database, "id", question.id) ?? question;
    return ok({ question: answered, message: stored });
  },
});

/** Closes a question that is still open, with the reason. */
export const closeQuestionTask: StoreTask<QuestionClosing, QuestionRecord | undefined> = defineTask(
  {
    name: "questions.close",
    access: "write",
    input: questionClosingSchema,
    output: questionRecordSchema.optional(),
    run: (database, closing) =>
      closeOpen(database, { id: closing.questionId, reason: closing.reason, atMs: closing.atMs }),
  },
);

/** Keeps one surface's copy of a question; the same copy again changes nothing. */
export const keepQuestionCopyTask: StoreTask<QuestionCopy, null> = defineTask({
  name: "questions.keepCopy",
  access: "write",
  input: questionCopySchema,
  output: z.null(),
  run(database, copy) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .insertInto("question_messages")
        .values({
          question_id: copy.questionId,
          surface: copy.surface,
          chat_id: copy.chatId,
          topic_id: copy.topicId ?? null,
          message_id: copy.messageId,
          sent_at: copy.sentAtMs,
        })
        .onConflict((conflict) => conflict.doNothing()),
    );
    return null;
  },
});

/** The copies of a question, in the order they were sent. */
export const questionCopiesTask: StoreTask<string, readonly QuestionCopy[]> = defineTask({
  name: "questions.copies",
  access: "read",
  input: idSchema("qst"),
  output: z.array(questionCopySchema),
  run(database, question) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("question_messages")
        .selectAll()
        .where("question_id", "=", question)
        .orderBy("sent_at")
        .orderBy("chat_id"),
    ).rows;
    return rows.map((row) =>
      questionCopySchema.parse({
        questionId: row.question_id,
        surface: row.surface,
        chatId: row.chat_id,
        ...field("topicId", row.topic_id),
        messageId: row.message_id,
        sentAtMs: row.sent_at,
      }),
    );
  },
});
