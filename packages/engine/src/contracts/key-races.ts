import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { IntentDraft } from "../intents/intent-record.js";
import { identityOf } from "./identity-store-contract.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import {
  answerOf,
  conflict,
  firstOf,
  type MoneyRaceSubject,
  race,
  settled,
} from "./money-race-runs.js";
import { checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

// Writers that insert one key their caller chose at once (decision 0413): the first to commit
// stores it, and every other gets the port's own answer, never a broken constraint, on any
// database, whether the loser read the key first or met it on a rerun.

function assertOneWon(answers: readonly string[], refusal: string): void {
  for (const answer of answers) {
    assert.ok(["ok", refusal, conflict].includes(answer), answer);
  }
  assert.equal(answers.filter((answer) => answer === "ok").length, 1);
}

/** Writers that create one intent id at once store it once; every other create is `exists`. */
async function createsOneIntentIdOnce(subject: MoneyRaceSubject): Promise<void> {
  const answers = await race(subject, async ({ intents }, index) => {
    const draft = { ...intentDraft(subject, 1), atMs: 1_000 + index };
    return answerOf(await settled(intents.create(draft, live())));
  });
  assertOneWon(answers, "exists");
  const { intents } = firstOf(subject);
  const stored = await intents.get(fixtureId("int", 1), live());
  assert.equal(stored?.createdAtMs, 1_000 + answers.indexOf("ok"));
  assert.equal((await intents.events(fixtureId("int", 1), live())).length, 1);
}

/**
 * Writers that create intents of one launch draft reference at once, each its own intent with no
 * ledger entry, store one; every other create is `exists` and stores nothing.
 */
async function createsOneIntentPerDraftRef(subject: MoneyRaceSubject): Promise<void> {
  const draftRef = "AbCdEfGh-_123456";
  const answers = await race(subject, async ({ intents }, index) => {
    const { ledger: _ledger, ...draft } = intentDraft(subject, index + 1);
    const launch: IntentDraft = { ...draft, kind: "launchToken", draftRef };
    return answerOf(await settled(intents.create(launch, live())));
  });
  assertOneWon(answers, "exists");
  const { intents } = firstOf(subject);
  const winner = fixtureId("int", answers.indexOf("ok") + 1);
  assert.equal((await intents.byDraftRef(draftRef, live()))?.id, winner);
  const stored = await inOrder([...answers.keys()], async (index) =>
    intents.get(fixtureId("int", index + 1), live()),
  );
  assert.deepEqual(
    stored.filter((intent) => intent !== undefined).map(({ id }) => id),
    [winner],
  );
}

/**
 * Writers that each register the agent's identity with their own intent's move at once store one;
 * every other move is `stale` and moves nothing.
 */
async function registersOneIdentityPerAgent(subject: MoneyRaceSubject): Promise<void> {
  const { intents } = firstOf(subject);
  const numbers = subject.writers.map((_, index) => index + 1);
  await inOrder(numbers, async (n) => intents.create(intentDraft(subject, n), live()));
  const answers = await race(subject, async (writer, index) => {
    const identity = identityOf(subject, String(index + 1));
    const move = { ...intentMove(index + 1, 0, "reconciled"), identity };
    return answerOf(await settled(writer.intents.transition(move, live())));
  });
  assertOneWon(answers, "stale");
  const winner = answers.indexOf("ok") + 1;
  const held = await subject.identities.get(subject.agentId, live());
  assert.equal(held?.onchainId, String(winner));
  const versions = await inOrder(numbers, async (n) => intents.get(fixtureId("int", n), live()));
  assert.deepEqual(
    versions.map((intent) => intent?.version),
    numbers.map((n) => (n === winner ? 1 : 0)),
  );
}

/** The races of keys a caller chose, on a fresh database from `create` each. */
export function keyRaces(create: () => Promise<MoneyRaceSubject>): readonly ContractCheck[] {
  return [
    checkOn(
      "stores one intent of an id the writers create at once",
      create,
      createsOneIntentIdOnce,
    ),
    checkOn(
      "stores one intent of a launch draft reference the writers create at once",
      create,
      createsOneIntentPerDraftRef,
    ),
    checkOn(
      "stores one identity of an agent the writers register at once",
      create,
      registersOneIdentityPerAgent,
    ),
  ];
}
