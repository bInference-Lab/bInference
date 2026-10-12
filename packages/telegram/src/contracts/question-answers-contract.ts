import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { QuestionAnswers } from "../ports.js";

/** An engine with one open question of two choices for the owner, and its button reference. */
export interface QuestionAnswersSubject {
  readonly answers: QuestionAnswers;
  readonly ref: string;
  readonly ownerId: number;
  /** How many answers the agent has heard of so far. */
  readonly heard: () => Promise<number>;
}

/** Makes a fresh subject for each check. */
export interface QuestionAnswersHarness {
  create(): Promise<QuestionAnswersSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const unknownRef = "ZZZZZZZZZZZZZZZZ";

async function unknownRefStands(subject: QuestionAnswersSubject): Promise<void> {
  const press = { ref: unknownRef, choice: 0, presserId: subject.ownerId };
  assert.deepEqual(await subject.answers.answer(press, live()), { status: "unknown" });
  assert.equal(await subject.heard(), 0);
}

async function strangerChangesNothing(subject: QuestionAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const stranger = { ref, choice: 0, presserId: ownerId + 1 };
  assert.deepEqual(await answers.answer(stranger, live()), { status: "unknown" });
  assert.equal(await subject.heard(), 0);
  const owner = { ref, choice: 1, presserId: ownerId };
  assert.deepEqual(await answers.answer(owner, live()), { status: "answered" });
}

async function firstAnswerWins(subject: QuestionAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const press = { ref, choice: 0, presserId: ownerId };
  assert.deepEqual(await answers.answer(press, live()), { status: "answered" });
  assert.deepEqual(await answers.answer(press, live()), { status: "closed" });
  assert.deepEqual(await answers.answer({ ...press, choice: 1 }, live()), { status: "closed" });
  assert.equal(await subject.heard(), 1);
}

async function refusesAborted(subject: QuestionAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const reason = new Error("stopped by the caller");
  const press = { ref, choice: 0, presserId: ownerId };
  await assert.rejects(answers.answer(press, { signal: AbortSignal.abort(reason) }), reason);
  assert.equal(await subject.heard(), 0);
  assert.deepEqual(await answers.answer(press, live()), { status: "answered" });
}

/** The contract every `QuestionAnswers` adapter passes. */
export function questionAnswersContract(harness: QuestionAnswersHarness): readonly ContractCheck[] {
  const on =
    (run: (subject: QuestionAnswersSubject) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "answers nothing for a reference no question has", run: on(unknownRefStands) },
    { name: "answers nothing for anyone but the owner", run: on(strangerChangesNothing) },
    { name: "takes the first answer once; later presses see it closed", run: on(firstAnswerWins) },
    { name: "refuses a call on an aborted signal and answers nothing", run: on(refusesAborted) },
  ];
}
