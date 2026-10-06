import assert from "node:assert/strict";
import {
  cardOf,
  confirmationOf,
  intentDraft,
  intentLedger,
  intentMove,
  type IntentStoreSubject,
} from "./intent-fixtures.js";
import { fixtureId, live } from "./store-fixtures.js";

const intentId = fixtureId("int", 1);

async function awaitingCard(subject: IntentStoreSubject): Promise<void> {
  await subject.store.create(intentDraft(subject, 1), live());
  const opened = await subject.store.transition(
    { ...intentMove(1, 0, "awaiting_confirmation"), openCard: cardOf(1, 1) },
    live(),
  );
  assert.ok(opened.ok);
}

/** Card versions open and close with the intent's moves. */
export async function closesWithMoves(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  await awaitingCard(subject);
  const requote = {
    ...intentMove(1, 1, "awaiting_confirmation"),
    closeCard: { id: cardOf(1, 1).id, reason: "replaced" },
    openCard: cardOf(1, 2),
  } as const;
  const expire = {
    ...intentMove(1, 2, "expired"),
    closeCard: { id: cardOf(1, 2).id, reason: "expired" },
  } as const;
  assert.ok((await store.transition(requote, live())).ok);
  assert.ok((await store.transition(expire, live())).ok);
  assert.deepEqual(await store.cards(intentId, live()), [
    { ...cardOf(1, 1), intentId, closedAtMs: requote.atMs, closeReason: "replaced" },
    { ...cardOf(1, 2), intentId, closedAtMs: expire.atMs, closeReason: "expired" },
  ]);
  assert.equal(await store.confirmation(intentId, live()), undefined);
}

/** The move to `confirmed` records the owner's one confirmation. */
export async function confirmsOnce(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  await awaitingCard(subject);
  const confirm = {
    ...intentMove(1, 1, "confirmed"),
    closeCard: { id: cardOf(1, 1).id, reason: "confirmed" },
    confirmation: confirmationOf(1, 1),
  } as const;
  assert.ok((await store.transition(confirm, live())).ok);
  const confirmation = { ...confirmationOf(1, 1), intentId, atMs: confirm.atMs };
  assert.deepEqual(await store.confirmation(intentId, live()), confirmation);
  const again = {
    ...intentMove(1, 2, "confirmed"),
    confirmation: { ...confirmationOf(1, 1), id: fixtureId("cnf", 99) },
  };
  await assert.rejects(store.transition(again, live()), { code: "store.constraint" });
  assert.equal((await store.get(intentId, live()))?.version, 2);
  assert.deepEqual(await store.confirmation(intentId, live()), confirmation);
  assert.equal((await store.events(intentId, live())).length, 3);
}

/** A move that closes a card version that is not open fails and writes nothing. */
export async function refusesClosedCard(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  await awaitingCard(subject);
  const deny = {
    ...intentMove(1, 1, "denied"),
    closeCard: { id: cardOf(1, 1).id, reason: "denied" },
  } as const;
  assert.ok((await store.transition(deny, live())).ok);
  const closeAgain = {
    ...intentMove(1, 2, "cancelled"),
    closeCard: { id: cardOf(1, 1).id, reason: "cancelled" },
    ledger: intentLedger(1, 3, "cancelled"),
  } as const;
  await assert.rejects(store.transition(closeAgain, live()), { code: "store.card_not_open" });
  await store.create(intentDraft(subject, 2), live());
  await store.transition(
    { ...intentMove(2, 0, "awaiting_confirmation"), openCard: cardOf(2, 1) },
    live(),
  );
  const closeOther = {
    ...closeAgain,
    closeCard: { id: cardOf(2, 1).id, reason: "cancelled" },
  } as const;
  await assert.rejects(store.transition(closeOther, live()), { code: "store.card_not_open" });
  assert.equal((await store.get(intentId, live()))?.state, "denied");
  assert.equal((await ledger.last(live()))?.seq, 2);
}

/** A card version the intent already has is refused, and the move writes nothing. */
export async function refusesTakenVersion(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  await awaitingCard(subject);
  const sameVersion = { ...cardOf(1, 1), id: fixtureId("crd", 99) };
  const move = { ...intentMove(1, 1, "awaiting_confirmation"), openCard: sameVersion };
  await assert.rejects(store.transition(move, live()), { code: "store.constraint" });
  assert.equal((await store.get(intentId, live()))?.version, 1);
  assert.deepEqual(await store.cards(intentId, live()), [{ ...cardOf(1, 1), intentId }]);
}
