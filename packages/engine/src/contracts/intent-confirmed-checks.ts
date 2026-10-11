import assert from "node:assert/strict";
import type { IntentState } from "../intents/intent-state.js";
import { intentDraft, intentMove, type IntentStoreSubject } from "./intent-fixtures.js";
import { assertRefusesAborted, fixtureId, inOrder, live } from "./store-fixtures.js";

// Above 2^64, so an adapter that stores amounts as 64-bit integers fails.
const huge = 18_446_744_073_709_551_617n;

interface Planted {
  readonly n: number;
  readonly isPaper: boolean;
  readonly moves: readonly IntentState[];
  readonly valueUsdMicros?: bigint;
}

// Intent `n` proposed, then moved through `moves`, its value stored with the first move.
async function plant(subject: IntentStoreSubject, planted: Planted): Promise<void> {
  const { n, isPaper, moves, valueUsdMicros } = planted;
  const created = await subject.store.create({ ...intentDraft(subject, n), isPaper }, live());
  assert.ok(created.ok);
  await inOrder([...moves.keys()], async (index) => {
    const state = moves[index];
    assert.ok(state !== undefined);
    const fields = index === 0 && valueUsdMicros !== undefined ? { valueUsdMicros } : {};
    const moved = await subject.store.transition(
      { ...intentMove(n, index, state), fields },
      live(),
    );
    assert.ok(moved.ok);
  });
}

/**
 * Lists one agent's intents of one mode confirmed since a time, each once with when it was first
 * confirmed, its state now and its stored value, oldest first.
 */
export async function listsConfirmedSince(subject: IntentStoreSubject): Promise<void> {
  const { store, agentId } = subject;
  await plant(subject, {
    n: 1,
    isPaper: true,
    moves: ["confirmed", "paper_filled"],
    valueUsdMicros: huge,
  });
  await plant(subject, { n: 2, isPaper: true, moves: ["confirmed", "cancelled"] });
  await plant(subject, { n: 3, isPaper: false, moves: ["confirmed"], valueUsdMicros: 5n });
  await plant(subject, { n: 4, isPaper: true, moves: ["checked"], valueUsdMicros: 7n });
  const again: readonly IntentState[] = ["confirmed", "awaiting_confirmation", "confirmed"];
  await plant(subject, { n: 5, isPaper: true, moves: again });
  const paper = { agentId, isPaper: true, fromMs: 0 };
  assert.deepEqual(await store.confirmedSince(paper, live()), [
    {
      intentId: fixtureId("int", 1),
      state: "paper_filled",
      confirmedAtMs: 1_001,
      valueUsdMicros: huge,
    },
    { intentId: fixtureId("int", 2), state: "cancelled", confirmedAtMs: 2_001 },
    { intentId: fixtureId("int", 5), state: "confirmed", confirmedAtMs: 5_001 },
  ]);
  assert.deepEqual(
    (await store.confirmedSince({ ...paper, fromMs: 1_002 }, live())).map(
      ({ intentId }) => intentId,
    ),
    [fixtureId("int", 2), fixtureId("int", 5)],
  );
  assert.deepEqual(await store.confirmedSince({ ...paper, isPaper: false }, live()), [
    { intentId: fixtureId("int", 3), state: "confirmed", confirmedAtMs: 3_001, valueUsdMicros: 5n },
  ]);
  const stranger = { ...paper, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.confirmedSince(stranger, live()), []);
  await assertRefusesAborted(async (options) => store.confirmedSince(paper, options));
}
