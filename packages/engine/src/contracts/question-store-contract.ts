import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { AgentInboxStore, QuestionStore } from "../chat/ports.js";
import {
  type QuestionAnswerDraft,
  questionOpenMs,
  type QuestionRecord,
} from "../chat/question-record.js";
import { fillAgentInbox } from "./inbox-fixtures.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** A question store under test, the agent inbox of the same database, and an agent there. */
export interface QuestionSubject {
  readonly questions: QuestionStore;
  readonly agentInbox: AgentInboxStore;
  readonly agentId: Id<"agt">;
}

/** Makes a fresh subject for each check. */
export interface QuestionStoreHarness {
  create(): Promise<QuestionSubject>;
}

const session = fixtureId("ses", 1);

function question(subject: QuestionSubject, n: number, atMs = 1_000 * n): QuestionRecord {
  return {
    id: fixtureId("qst", n),
    agentId: subject.agentId,
    sessionId: session,
    turnId: fixtureId("trn", n),
    text: `question ${String(n)}`,
    choices: ["Yes", "No"],
    ref: `ref${String(n).padStart(13, "0")}`,
    state: "open",
    createdAtMs: atMs,
    closesAtMs: atMs + questionOpenMs,
  };
}

function answerOf(n: number, choice: number, atMs: number): QuestionAnswerDraft {
  return {
    questionId: fixtureId("qst", n),
    answer: { choice, surface: "telegram", atMs },
    message: {
      id: fixtureId("msg", 100 + n),
      turnId: fixtureId("trn", 100 + n),
      opens: session,
      payload: {
        text: "No",
        surface: "telegram",
        answer: { question: fixtureId("qst", n), choice },
      },
    },
  };
}

async function asked(subject: QuestionSubject, record: QuestionRecord) {
  return subject.questions.ask(record, live());
}

async function asksAndReplaces(subject: QuestionSubject): Promise<void> {
  const { questions, agentId } = subject;
  const first = question(subject, 1);
  assert.deepEqual(await asked(subject, first), { asked: first });
  assert.deepEqual(await questions.openOf(agentId, live()), first);
  assert.deepEqual(await questions.byRef(first.ref, live()), first);
  const second = question(subject, 2);
  const { closed } = await asked(subject, second);
  const replaced = { ...first, state: "closed", closeReason: "replaced", closedAtMs: 2_000 };
  assert.deepEqual(closed, replaced);
  assert.deepEqual(await questions.get(first.id, live()), replaced);
  assert.deepEqual(await questions.openOf(agentId, live()), second);
  // A question 24 hours old closes as expired when the next one comes.
  const late = question(subject, 3, second.closesAtMs);
  const expired = await asked(subject, late);
  assert.equal(expired.closed?.closeReason, "expired");
  assert.equal(await questions.get(fixtureId("qst", 9), live()), undefined);
  assert.equal(await questions.byRef("ZZZZZZZZZZZZZZZZ", live()), undefined);
}

async function answersOnceWithItsMessage(subject: QuestionSubject): Promise<void> {
  const { questions, agentInbox, agentId } = subject;
  await asked(subject, question(subject, 1));
  const answered = await questions.answer(answerOf(1, 1, 1_500), live());
  assert.ok(answered.ok);
  assert.equal(answered.value.question.state, "answered");
  assert.deepEqual(answered.value.question.answer, { choice: 1, surface: "telegram", atMs: 1_500 });
  assert.equal(answered.value.message.kind, "inbox/message");
  assert.equal(answered.value.message.turnId, fixtureId("trn", 101));
  const again = await questions.answer({ ...answerOf(1, 0, 1_600) }, live());
  assert.deepEqual(again, { ok: false, error: "closed" });
  const untaken = await agentInbox.untaken({ agentId, limit: 10 }, live());
  assert.deepEqual(
    untaken.map((message) => message.id),
    [fixtureId("msg", 101)],
  );
  assert.equal(await questions.openOf(agentId, live()), undefined);
}

async function refusesClosedAndExpired(subject: QuestionSubject): Promise<void> {
  const { questions, agentInbox, agentId } = subject;
  assert.deepEqual(await questions.answer(answerOf(7, 0, 1), live()), {
    ok: false,
    error: "not_found",
  });
  const first = question(subject, 1);
  await asked(subject, first);
  const late = await questions.answer(answerOf(1, 0, first.closesAtMs), live());
  assert.deepEqual(late, { ok: false, error: "closed" });
  const cleared = await questions.close(
    { questionId: first.id, reason: "cleared", atMs: 1_200 },
    live(),
  );
  assert.equal(cleared?.state, "closed");
  assert.equal(cleared?.closeReason, "cleared");
  assert.equal(cleared?.closedAtMs, 1_200);
  const twice = { questionId: first.id, reason: "expired", atMs: 1_300 } as const;
  assert.equal(await questions.close(twice, live()), undefined);
  assert.deepEqual(await questions.answer(answerOf(1, 0, 1_400), live()), {
    ok: false,
    error: "closed",
  });
  assert.deepEqual(await agentInbox.untaken({ agentId, limit: 10 }, live()), []);
}

async function refusesWhenTheInboxIsFull(subject: QuestionSubject): Promise<void> {
  const { questions, agentInbox, agentId } = subject;
  await asked(subject, question(subject, 1));
  await fillAgentInbox(agentInbox, { agentId, session });
  assert.deepEqual(await questions.answer(answerOf(1, 0, 1_500), live()), {
    ok: false,
    error: "busy",
  });
  assert.equal((await questions.openOf(agentId, live()))?.state, "open");
}

async function keepsCopies(subject: QuestionSubject): Promise<void> {
  const { questions } = subject;
  await asked(subject, question(subject, 1));
  const copy = {
    questionId: fixtureId("qst", 1),
    surface: "telegram",
    chatId: 42,
    messageId: 7,
    sentAtMs: 1_100,
  } as const;
  await questions.keepCopy(copy, live());
  await questions.keepCopy(copy, live());
  const second = { ...copy, chatId: 43, topicId: 5, messageId: 8, sentAtMs: 1_200 };
  await questions.keepCopy(second, live());
  assert.deepEqual(await questions.copies(fixtureId("qst", 1), live()), [copy, second]);
  assert.deepEqual(await questions.copies(fixtureId("qst", 2), live()), []);
}

async function refusesTakenIds(subject: QuestionSubject): Promise<void> {
  const first = question(subject, 1);
  await asked(subject, first);
  await assert.rejects(asked(subject, { ...question(subject, 2), id: first.id }), {
    code: "store.constraint",
  });
  await assert.rejects(asked(subject, { ...question(subject, 3), ref: first.ref }), {
    code: "store.constraint",
  });
  assert.deepEqual(await subject.questions.openOf(subject.agentId, live()), first);
}

async function refusesAborted(subject: QuestionSubject): Promise<void> {
  const { questions, agentId } = subject;
  await assertRefusesAborted(async (options) => questions.ask(question(subject, 1), options));
  await assertRefusesAborted(async (options) => questions.openOf(agentId, options));
  await assertRefusesAborted(async (options) => questions.answer(answerOf(1, 0, 1), options));
  assert.equal(await questions.openOf(agentId, live()), undefined);
}

/** The contract every `QuestionStore` adapter passes, with its database's agent inbox. */
export function questionStoreContract(harness: QuestionStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<QuestionSubject> => harness.create();
  return [
    checkOn("keeps one open question per agent and closes the one before", create, asksAndReplaces),
    checkOn(
      "answers once and stores the answer's message with it",
      create,
      answersOnceWithItsMessage,
    ),
    checkOn(
      "refuses an answer to a closed, expired or unknown question",
      create,
      refusesClosedAndExpired,
    ),
    checkOn("refuses an answer while the agent's inbox is full", create, refusesWhenTheInboxIsFull),
    checkOn("keeps each copy once, in the order they were sent", create, keepsCopies),
    checkOn("refuses an id or a reference in use", create, refusesTakenIds),
    checkOn("refuses a call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
