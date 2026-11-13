import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { FreezeWrite } from "../intents/freeze-write.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import { draft as agentDraft } from "./agent-store-contract.js";
import { cardOf, intentDraft, intentMove, type IntentStoreSubject } from "./intent-fixtures.js";
import { agentOf } from "./intent-freeze-checks.js";
import { checkOn, fixtureId, live } from "./store-fixtures.js";

const ownAtMs = 40_000;
const pulledAtMs = 50_000;

function entry(n: number, change: { readonly atMs: number; readonly kind: string }): LedgerDraft {
  return { id: fixtureId("led", 9_500 + n), ...change, data: { by: "breaker" } };
}

/** A breaker write's change: its version, its pull or lift, and what its plan read. */
export interface BreakerChange {
  readonly atMs: number;
  readonly version: number;
  readonly isPulled: boolean;
  /** The version the plan read; the one before `version` when absent. */
  readonly fromVersion?: number;
  readonly changedAtMs?: number;
  readonly isTold?: boolean;
}

/** The breaker's pull or lift at its version, at `atMs`, naming no agent and moving nothing. */
export function breakerWrite(n: number, change: BreakerChange): FreezeWrite {
  const { atMs, version, isPulled, changedAtMs } = change;
  const fromVersion = change.fromVersion ?? version - 1;
  return {
    atMs,
    isFrozen: isPulled,
    agents: [],
    isWholeInstall: false,
    moves: [],
    orders: [],
    ledger: [entry(n, { atMs, kind: isPulled ? "freeze" : "unfreeze" })],
    breaker: {
      version,
      fromVersion,
      isPulled,
      isTold: change.isTold ?? false,
      ...(changedAtMs === undefined ? {} : { changedAtMs }),
    },
  };
}

/** The owner's freeze or unfreeze of the whole install, the subject's agent at `version`. */
function ownerWrite(
  subject: IntentStoreSubject,
  change: { readonly atMs: number; readonly isFrozen: boolean; readonly version: number },
): FreezeWrite {
  const { atMs, isFrozen, version } = change;
  return {
    atMs,
    isFrozen,
    agents: [{ agentId: subject.agentId, expectedVersion: version }],
    isWholeInstall: true,
    moves: [],
    orders: [],
    ledger: [],
  };
}

async function heldTimes(subject: IntentStoreSubject) {
  const agent = await agentOf(subject);
  return [agent?.frozenAtMs, agent?.ownFrozenAtMs, agent?.breakerAtMs];
}

async function installMark(subject: IntentStoreSubject) {
  const facts = await subject.install.read(live());
  return [facts.frozenAtMs, facts.breakerAtMs, facts.breakerVersion];
}

/**
 * A pull marks the install alone: every agent reads held from the pull, one made later too, with
 * no freeze of the owner's, and the owner's columns stay as they were.
 */
async function holdsByItsOwnMark(subject: IntentStoreSubject): Promise<void> {
  const { store, agents, ledger } = subject;
  assert.deepEqual(await heldTimes(subject), [undefined, undefined, undefined]);
  const pulled = await store.freeze(
    breakerWrite(1, { atMs: pulledAtMs, version: 1, isPulled: true }),
    live(),
  );
  assert.ok(pulled.ok);
  assert.deepEqual(await heldTimes(subject), [pulledAtMs, undefined, pulledAtMs]);
  assert.deepEqual(await installMark(subject), [undefined, pulledAtMs, 1]);
  assert.equal((await ledger.last(live()))?.kind, "freeze");
  const made = await agents.create({ ...agentDraft(7), atMs: pulledAtMs + 1 }, live());
  assert.ok(made.ok);
  const { frozenAtMs, ownFrozenAtMs, breakerAtMs } = made.value.agent;
  assert.deepEqual([frozenAtMs, ownFrozenAtMs, breakerAtMs], [pulledAtMs, undefined, pulledAtMs]);
}

/**
 * The owner's freeze before the pull outlasts the lift, with its own time; the pull keeps its
 * first time across a second version.
 */
async function keepsTheOwnersFreeze(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  const frozen = await store.freeze(
    ownerWrite(subject, { atMs: ownAtMs, isFrozen: true, version: 0 }),
    live(),
  );
  assert.ok(frozen.ok);
  const pull = (version: number, atMs: number) =>
    breakerWrite(version, { atMs, version, isPulled: true });
  assert.ok((await store.freeze(pull(1, pulledAtMs), live())).ok);
  assert.ok((await store.freeze(pull(2, pulledAtMs + 5), live())).ok);
  assert.deepEqual(await heldTimes(subject), [ownAtMs, ownAtMs, pulledAtMs]);
  const lift = breakerWrite(3, { atMs: pulledAtMs + 9, version: 3, isPulled: false });
  assert.ok((await store.freeze(lift, live())).ok);
  assert.deepEqual(await heldTimes(subject), [ownAtMs, undefined, undefined]);
  assert.deepEqual(await installMark(subject), [ownAtMs, undefined, 3]);
}

/** An owner's freeze and unfreeze while the breaker holds never move the breaker's mark. */
async function leavesTheBreakersHold(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  const pull = breakerWrite(1, { atMs: pulledAtMs, version: 1, isPulled: true });
  assert.ok((await store.freeze(pull, live())).ok);
  const freeze = ownerWrite(subject, { atMs: pulledAtMs + 1, isFrozen: true, version: 0 });
  assert.ok((await store.freeze(freeze, live())).ok);
  assert.deepEqual(await heldTimes(subject), [pulledAtMs, pulledAtMs + 1, pulledAtMs]);
  const unfreeze = ownerWrite(subject, { atMs: pulledAtMs + 2, isFrozen: false, version: 1 });
  assert.ok((await store.freeze(unfreeze, live())).ok);
  assert.deepEqual(await heldTimes(subject), [pulledAtMs, undefined, pulledAtMs]);
  assert.deepEqual(await installMark(subject), [undefined, pulledAtMs, 1]);
}

/**
 * A version at or below the one applied, or one planned on a version the install no longer holds,
 * writes nothing: no mark, no move, no entry.
 */
async function refusesAnOldVersion(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  assert.ok((await store.create(intentDraft(subject, 1), live())).ok);
  const pull = breakerWrite(1, { atMs: pulledAtMs, version: 2, fromVersion: 0, isPulled: true });
  assert.ok((await store.freeze(pull, live())).ok);
  const last = await ledger.last(live());
  const cancel = { ...intentMove(1, 0, "cancelled"), atMs: pulledAtMs + 1 };
  const again = { ...breakerWrite(2, { atMs: pulledAtMs + 1, version: 2, isPulled: true }) };
  const lift = breakerWrite(3, { atMs: pulledAtMs + 1, version: 1, isPulled: false });
  const planned = { atMs: pulledAtMs + 1, version: 3, fromVersion: 1, isPulled: false };
  const stale = { ok: false, error: "stale" };
  assert.deepEqual(await store.freeze({ ...again, moves: [cancel] }, live()), stale);
  assert.deepEqual(await store.freeze(lift, live()), stale);
  assert.deepEqual(await store.freeze(breakerWrite(4, planned), live()), stale);
  assert.equal((await store.get(fixtureId("int", 1), live()))?.state, "proposed");
  assert.deepEqual(await ledger.last(live()), last);
  assert.deepEqual(await installMark(subject), [undefined, pulledAtMs, 2]);
}

/**
 * A pull and a lift wait to be told until the install store marks them told; a version alone is
 * told with its write. The row's time a pull took hold at outlasts the lift.
 */
async function waitsToBeTold(subject: IntentStoreSubject): Promise<void> {
  const { store, install } = subject;
  const told = async () => {
    const facts = await install.read(live());
    return [facts.breakerVersion, facts.breakerToldVersion, facts.breakerPulledAtMs];
  };
  const pull = { atMs: pulledAtMs, version: 1, isPulled: true, changedAtMs: pulledAtMs - 7 };
  assert.ok((await store.freeze(breakerWrite(1, pull), live())).ok);
  assert.deepEqual(await told(), [1, undefined, pulledAtMs - 7]);
  assert.deepEqual(await install.tellBreaker(2, live()), { ok: false, error: "stale" });
  assert.deepEqual(await install.tellBreaker(1, live()), { ok: true, value: undefined });
  assert.deepEqual(await install.tellBreaker(1, live()), { ok: false, error: "stale" });
  const again = { atMs: pulledAtMs + 1, version: 2, isPulled: true, changedAtMs: pulledAtMs };
  assert.ok((await store.freeze(breakerWrite(2, { ...again, isTold: true }), live())).ok);
  assert.deepEqual(await told(), [2, 2, pulledAtMs - 7]);
  const lift = { atMs: pulledAtMs + 2, version: 3, isPulled: false };
  assert.ok((await store.freeze(breakerWrite(3, lift), live())).ok);
  assert.deepEqual(await told(), [3, 2, pulledAtMs - 7]);
  const next = { atMs: pulledAtMs + 3, version: 4, isPulled: true };
  assert.ok((await store.freeze(breakerWrite(4, next), live())).ok);
  assert.deepEqual(await told(), [4, 2, pulledAtMs + 3]);
}

/** A pull cancels unsigned intents in its own write, a card closed with its move. */
async function cancelsInItsWrite(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  assert.ok((await store.create(intentDraft(subject, 2), live())).ok);
  const opened = { ...intentMove(2, 0, "awaiting_confirmation"), openCard: cardOf(2, 1) };
  assert.ok((await store.transition(opened, live())).ok);
  const cancel = {
    ...intentMove(2, 1, "cancelled"),
    atMs: pulledAtMs,
    closeCard: { id: cardOf(2, 1).id, reason: "cancelled" as const },
  };
  const pull = breakerWrite(1, { atMs: pulledAtMs, version: 1, isPulled: true });
  const pulled = await store.freeze({ ...pull, moves: [cancel] }, live());
  assert.ok(pulled.ok);
  assert.deepEqual(
    pulled.value.moves.map(({ intent }) => [intent.id, intent.state]),
    [[fixtureId("int", 2), "cancelled"]],
  );
  const [card] = await store.cards(fixtureId("int", 2), live());
  assert.equal(card?.closeReason, "cancelled");
}

/**
 * The checks of the breaker's mark of its own on the install (decision 0440): how it holds every
 * agent, and why neither its lift nor an owner's unfreeze ends the other's freeze.
 */
export function breakerFreezeChecks(
  create: () => Promise<IntentStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn("holds every agent by the breaker's mark of its own", create, holdsByItsOwnMark),
    checkOn("keeps the owner's freeze through the breaker's lift", create, keepsTheOwnersFreeze),
    checkOn("keeps the breaker's hold through the owner's unfreeze", create, leavesTheBreakersHold),
    checkOn("refuses a breaker write planned on another version", create, refusesAnOldVersion),
    checkOn("keeps the breaker's version told apart from the one applied", create, waitsToBeTold),
    checkOn("cancels unsigned intents in the breaker's own write", create, cancelsInItsWrite),
  ];
}
