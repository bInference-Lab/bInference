import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { CardStanding } from "@binference/engine/surfaces";
import type { CardAnswers } from "../ports.js";

/** An engine with one open card for the owner, and the card's callback reference. */
export interface CardAnswersSubject {
  readonly answers: CardAnswers;
  readonly ref: string;
  readonly ownerId: number;
}

/** Makes a fresh subject for each check. */
export interface CardAnswersHarness {
  create(): Promise<CardAnswersSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const unknownRef = "ZZZZZZZZZZZZZZZZ";

function closedBy(standing: CardStanding, outcome: "confirmed" | "denied"): void {
  assert.ok(standing.status === "closed", "the card is closed");
  assert.equal(standing.closing.outcome, outcome);
  assert.ok("answeredBy" in standing.closing, "the closing names who answered");
  assert.equal(standing.closing.answeredBy.surface, "telegram");
}

async function unknownRefStands(subject: CardAnswersSubject): Promise<void> {
  const press = { ref: unknownRef, decision: "confirm", presserId: subject.ownerId } as const;
  assert.deepEqual(await subject.answers.answer(press, live()), { status: "unknown" });
}

async function strangerChangesNothing(subject: CardAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const stranger = { ref, decision: "confirm", presserId: ownerId + 1 } as const;
  assert.deepEqual(await answers.answer(stranger, live()), { status: "unknown" });
  closedBy(await answers.answer({ ref, decision: "deny", presserId: ownerId }, live()), "denied");
}

async function firstAnswerWins(subject: CardAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const confirmed = await answers.answer({ ref, decision: "confirm", presserId: ownerId }, live());
  closedBy(confirmed, "confirmed");
  const later = await answers.answer({ ref, decision: "deny", presserId: ownerId }, live());
  assert.deepEqual(later, confirmed);
}

async function refusesAborted(subject: CardAnswersSubject): Promise<void> {
  const { answers, ref, ownerId } = subject;
  const reason = new Error("stopped by the caller");
  const press = { ref, decision: "confirm", presserId: ownerId } as const;
  await assert.rejects(answers.answer(press, { signal: AbortSignal.abort(reason) }), reason);
  closedBy(await answers.answer({ ...press, decision: "deny" }, live()), "denied");
}

/** The contract every `CardAnswers` adapter passes. */
export function cardAnswersContract(harness: CardAnswersHarness): readonly ContractCheck[] {
  const on =
    (run: (subject: CardAnswersSubject) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "answers nothing for a reference no card has", run: on(unknownRefStands) },
    { name: "answers nothing for anyone but the owner", run: on(strangerChangesNothing) },
    { name: "closes the card on the first answer; later ones see it", run: on(firstAnswerWins) },
    { name: "refuses a call on an aborted signal and answers nothing", run: on(refusesAborted) },
  ];
}
