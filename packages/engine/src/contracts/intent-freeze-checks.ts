import assert from "node:assert/strict";
import type { AgentRecord } from "../agents/agent-record.js";
import type { FreezeWrite } from "../intents/freeze-write.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import {
  cardOf,
  intentDraft,
  intentLedger,
  intentMove,
  type IntentStoreSubject,
} from "./intent-fixtures.js";
import { fixtureId, live } from "./store-fixtures.js";

const frozenAtMs = 50_000;

/** The subject's agent as its store lists it. */
export async function agentOf(subject: IntentStoreSubject): Promise<AgentRecord | undefined> {
  const listed = await subject.agents.list(live());
  return listed.find((agent) => agent.id === subject.agentId);
}

function freezeEntry(subject: IntentStoreSubject, n: number): LedgerDraft {
  return {
    id: fixtureId("led", 9_000 + n),
    atMs: frozenAtMs,
    agentId: subject.agentId,
    kind: "freeze",
    subject: subject.agentId,
    data: { surface: "cli" },
  };
}

// Intent 1 proposed, intent 2 waiting for the owner with its card open.
async function twoUnsigned(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(intentDraft(subject, 1), live());
  await store.create(intentDraft(subject, 2), live());
  const opened = { ...intentMove(2, 0, "awaiting_confirmation"), openCard: cardOf(2, 1) };
  assert.ok((await store.transition(opened, live())).ok);
}

function freezeOf(subject: IntentStoreSubject, agentVersion = 0): FreezeWrite {
  const cancel = (n: number, version: number) => ({
    ...intentMove(n, version, "cancelled"),
    atMs: frozenAtMs,
    ledger: intentLedger(n, 7, "cancelled"),
  });
  return {
    atMs: frozenAtMs,
    agents: [{ agentId: subject.agentId, expectedVersion: agentVersion }],
    moves: [
      cancel(1, 0),
      { ...cancel(2, 1), closeCard: { id: cardOf(2, 1).id, reason: "cancelled" } },
    ],
    ledger: [freezeEntry(subject, 1)],
  };
}

/** A freeze marks its agents and cancels their intents in one write, its own entries last. */
export async function freezesInOneWrite(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  await twoUnsigned(subject);
  const frozen = await store.freeze(freezeOf(subject), live());
  assert.ok(frozen.ok);
  const { agents: marked, moves, ledgerEntries } = frozen.value;
  assert.deepEqual(
    marked.map(({ id, frozenAtMs: at, changedAtMs, version }) => [id, at, changedAtMs, version]),
    [[subject.agentId, frozenAtMs, frozenAtMs, 1]],
  );
  const stored = await agentOf(subject);
  assert.deepEqual([stored?.frozenAtMs, stored?.version], [frozenAtMs, 1]);
  assert.deepEqual(
    moves.map(({ intent }) => [intent.id, intent.state, intent.version]),
    [
      [fixtureId("int", 1), "cancelled", 1],
      [fixtureId("int", 2), "cancelled", 2],
    ],
  );
  const [card] = await store.cards(fixtureId("int", 2), live());
  assert.deepEqual([card?.closedAtMs, card?.closeReason], [frozenAtMs, "cancelled"]);
  assert.deepEqual(
    ledgerEntries.map(({ kind, seq }) => [kind, seq]),
    [["freeze", 5]],
  );
  assert.deepEqual(await ledger.last(live()), ledgerEntries[0]);
  assert.deepEqual(
    moves.map(({ ledgerEntry }) => ledgerEntry?.seq),
    [3, 4],
  );
}

async function assertUnchanged(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  const stored = await agentOf(subject);
  assert.deepEqual([stored?.frozenAtMs, stored?.version], [undefined, 0]);
  const [first, second] = await Promise.all([
    store.get(fixtureId("int", 1), live()),
    store.get(fixtureId("int", 2), live()),
  ]);
  assert.deepEqual([first?.state, second?.state], ["proposed", "awaiting_confirmation"]);
  const [card] = await store.cards(fixtureId("int", 2), live());
  assert.equal(card?.closedAtMs, undefined);
  assert.equal((await ledger.last(live()))?.seq, 2);
}

/** A freeze that read one row at an old version, or names an unknown one, writes nothing. */
export async function refusesStaleFreeze(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  await twoUnsigned(subject);
  const write = freezeOf(subject);
  const [first, second] = write.moves;
  assert.ok(first !== undefined && second !== undefined);
  const staleMove = { ...write, moves: [first, { ...second, expectedVersion: 0 }] };
  assert.deepEqual(await store.freeze(staleMove, live()), { ok: false, error: "stale" });
  await assertUnchanged(subject);
  const staleAgent = freezeOf(subject, 4);
  assert.deepEqual(await store.freeze(staleAgent, live()), { ok: false, error: "stale" });
  await assertUnchanged(subject);
  const unknown = {
    ...write,
    agents: [{ agentId: fixtureId("agt", 77), expectedVersion: 0 }],
  };
  assert.deepEqual(await store.freeze(unknown, live()), { ok: false, error: "not_found" });
  const lost = { ...write, moves: [{ ...first, id: fixtureId("int", 99) }] };
  assert.deepEqual(await store.freeze(lost, live()), { ok: false, error: "not_found" });
  await assertUnchanged(subject);
}

/** An agent frozen before keeps the time it was first frozen. */
export async function keepsFirstFreeze(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  const first = { atMs: frozenAtMs, agents: freezeOf(subject).agents, moves: [], ledger: [] };
  assert.ok((await store.freeze(first, live())).ok);
  const again = { ...first, atMs: frozenAtMs + 1, agents: freezeOf(subject, 1).agents };
  const frozen = await store.freeze(again, live());
  assert.ok(frozen.ok);
  assert.deepEqual(
    frozen.value.agents.map(({ frozenAtMs: at, version }) => [at, version]),
    [[frozenAtMs, 2]],
  );
  const stored = await agentOf(subject);
  assert.deepEqual([stored?.frozenAtMs, stored?.changedAtMs], [frozenAtMs, frozenAtMs + 1]);
}
