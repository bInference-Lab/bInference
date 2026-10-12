import { err, type Id, ok } from "@binference/core";
import type { QuestionStore } from "../chat/ports.js";
import {
  isAnswerable,
  type QuestionAnswerDraft,
  type QuestionCopy,
  type QuestionRecord,
} from "../chat/question-record.js";
import type { MemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** The agent inbox an in-memory question store writes each answer's message to. */
export interface MemoryQuestionStoreOptions {
  readonly agentInbox: Pick<MemoryAgentInboxStore, "addNow">;
}

/** The rows of an in-memory question store: its questions by id, and their copies. */
interface QuestionRows {
  readonly all: () => readonly QuestionRecord[];
  readonly get: (id: Id<"qst">) => QuestionRecord | undefined;
  readonly put: (question: QuestionRecord) => void;
  readonly copies: () => readonly QuestionCopy[];
  readonly addCopy: (copy: QuestionCopy) => void;
}

function createRows(): QuestionRows {
  const questions = new Map<Id<"qst">, QuestionRecord>();
  const copies: QuestionCopy[] = [];
  return {
    all: () => [...questions.values()],
    get: (id) => questions.get(id),
    put(question) {
      questions.set(question.id, structuredClone(question));
    },
    copies: () => copies,
    addCopy(copy) {
      copies.push(structuredClone(copy));
    },
  };
}

function find(
  rows: QuestionRows,
  match: (question: QuestionRecord) => boolean,
): QuestionRecord | undefined {
  const found = rows.all().find(match);
  return found === undefined ? undefined : structuredClone(found);
}

function closed(
  question: QuestionRecord,
  reason: "replaced" | "cleared" | "expired",
  atMs: number,
): QuestionRecord {
  return { ...question, state: "closed", closeReason: reason, closedAtMs: atMs };
}

function ask(rows: QuestionRows, question: QuestionRecord) {
  const { id, ref, agentId, createdAtMs } = question;
  if (rows.get(id) !== undefined || find(rows, (stored) => stored.ref === ref) !== undefined) {
    throw constraintFault(`the question id ${id} or its reference is in use`);
  }
  const open = find(rows, (stored) => stored.agentId === agentId && stored.state === "open");
  const reason = open !== undefined && createdAtMs >= open.closesAtMs ? "expired" : "replaced";
  const before = open === undefined ? undefined : closed(open, reason, createdAtMs);
  if (before !== undefined) {
    rows.put(before);
  }
  rows.put(question);
  return { asked: structuredClone(question), ...(before === undefined ? {} : { closed: before }) };
}

function answer(
  rows: QuestionRows,
  inbox: MemoryQuestionStoreOptions["agentInbox"],
  draft: QuestionAnswerDraft,
) {
  const question = rows.get(draft.questionId);
  if (question === undefined) {
    return err("not_found" as const);
  }
  if (!isAnswerable(question, draft.answer.atMs)) {
    return err("closed" as const);
  }
  const { message } = draft;
  const stored = inbox.addNow({
    id: message.id,
    agentId: question.agentId,
    kind: "inbox/message",
    turnId: message.turnId,
    payload: message.payload,
    atMs: draft.answer.atMs,
    opens: message.opens,
  });
  if (!stored.ok) {
    return err(stored.error === "busy" ? ("busy" as const) : ("not_found" as const));
  }
  const answered: QuestionRecord = {
    ...question,
    state: "answered",
    answer: structuredClone(draft.answer),
    closedAtMs: draft.answer.atMs,
  };
  rows.put(answered);
  return ok({ question: structuredClone(answered), message: stored.value });
}

function keepCopy(rows: QuestionRows, copy: QuestionCopy): void {
  const kept = rows
    .copies()
    .some(
      (stored) =>
        stored.questionId === copy.questionId &&
        stored.surface === copy.surface &&
        stored.chatId === copy.chatId,
    );
  if (!kept) {
    rows.addCopy(copy);
  }
}

/** Creates an empty in-memory {@link QuestionStore} for tests, over the in-memory agent inbox. */
export function createMemoryQuestionStore(options: MemoryQuestionStoreOptions): QuestionStore {
  const rows = createRows();
  return {
    ask: async (question, call) => memoryCall(call, () => ask(rows, question)),
    get: async (id, call) => memoryCall(call, () => find(rows, (stored) => stored.id === id)),
    byRef: async (ref, call) => memoryCall(call, () => find(rows, (stored) => stored.ref === ref)),
    openOf: async (agent, call) =>
      memoryCall(call, () =>
        find(rows, (stored) => stored.agentId === agent && stored.state === "open"),
      ),
    answer: async (draft, call) =>
      memoryCall(call, () => answer(rows, options.agentInbox, structuredClone(draft))),
    close: async (closing, call) =>
      memoryCall(call, () => {
        const question = rows.get(closing.questionId);
        if (question?.state !== "open") {
          return undefined;
        }
        const after = closed(question, closing.reason, closing.atMs);
        rows.put(after);
        return structuredClone(after);
      }),
    keepCopy: async (copy, call) => memoryCall(call, () => keepCopy(rows, copy)),
    copies: async (question, call) =>
      memoryCall(call, () =>
        structuredClone(rows.copies().filter((copy) => copy.questionId === question)),
      ),
  };
}
