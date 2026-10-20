import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { LaunchDraftAnswers } from "../ports.js";

/** An engine with one open launch draft for the owner, and its button reference. */
export interface LaunchDraftAnswersSubject {
  readonly answers: LaunchDraftAnswers;
  readonly ref: string;
  readonly ownerId: number;
  /** How many launches the owner's presses started so far. */
  readonly started: () => Promise<number>;
}

/** Makes a fresh subject for each check. */
export interface LaunchDraftAnswersHarness {
  create(): Promise<LaunchDraftAnswersSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const unknownRef = "ZZZZZZZZZZZZZZZZ";

async function unknownRefStands(subject: LaunchDraftAnswersSubject): Promise<void> {
  const press = { ref: unknownRef, start: true, presserId: subject.ownerId };
  assert.deepEqual(await subject.answers.answer(press, live()), { status: "unknown" });
  assert.equal(await subject.started(), 0);
}

async function strangerChangesNothing(subject: LaunchDraftAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const stranger = { ref, presserId: ownerId + 1 };
  assert.deepEqual(await answers.answer({ ...stranger, start: false }, live()), {
    status: "unknown",
  });
  assert.deepEqual(await answers.answer({ ...stranger, start: true }, live()), {
    status: "unknown",
  });
  assert.equal(await subject.started(), 0);
  const owner = { ref, start: true, presserId: ownerId };
  assert.equal((await answers.answer(owner, live())).status, "started");
}

async function startsOnce(subject: LaunchDraftAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const press = { ref, start: true, presserId: ownerId };
  assert.equal((await answers.answer(press, live())).status, "started");
  assert.deepEqual(await answers.answer(press, live()), { status: "unknown" });
  assert.deepEqual(await answers.answer({ ...press, start: false }, live()), { status: "unknown" });
  assert.equal(await subject.started(), 1);
}

async function dropStartsNothing(subject: LaunchDraftAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const drop = { ref, start: false, presserId: ownerId };
  assert.deepEqual(await answers.answer(drop, live()), { status: "dropped" });
  assert.deepEqual(await answers.answer({ ...drop, start: true }, live()), { status: "unknown" });
  assert.equal(await subject.started(), 0);
}

async function refusesAborted(subject: LaunchDraftAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const reason = new Error("stopped by the caller");
  const press = { ref, start: true, presserId: ownerId };
  await assert.rejects(answers.answer(press, { signal: AbortSignal.abort(reason) }), reason);
  assert.equal(await subject.started(), 0);
  assert.equal((await answers.answer(press, live())).status, "started");
}

/** The contract every `LaunchDraftAnswers` adapter passes. */
export function launchDraftAnswersContract(
  harness: LaunchDraftAnswersHarness,
): readonly ContractCheck[] {
  const on =
    (run: (subject: LaunchDraftAnswersSubject) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "starts nothing for a reference no draft has", run: on(unknownRefStands) },
    { name: "starts nothing for anyone but the owner", run: on(strangerChangesNothing) },
    { name: "starts a draft once; later presses find none", run: on(startsOnce) },
    { name: "drops a draft, after which Start starts nothing", run: on(dropStartsNothing) },
    { name: "refuses a call on an aborted signal and starts nothing", run: on(refusesAborted) },
  ];
}
