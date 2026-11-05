import assert from "node:assert/strict";
import { assetRefSchema } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { IntentState } from "../intents/intent-state.js";
import { intentDraft, intentMove, type IntentStoreSubject } from "./intent-fixtures.js";
import { checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

// The order of each ordered read the intent store answers, pinned on rows of one millisecond
// written in an order their ids do not follow (database spec, section 6.7).

const instant = 50_000;

async function createAt(subject: IntentStoreSubject, n: number, atMs: number): Promise<void> {
  const created = await subject.store.create({ ...intentDraft(subject, n), atMs }, live());
  assert.ok(created.ok);
}

async function moveAt(
  subject: IntentStoreSubject,
  n: number,
  moves: readonly IntentState[],
): Promise<void> {
  await inOrder([...moves.keys()], async (version) => {
    const state = moves[version];
    assert.ok(state !== undefined);
    const moved = await subject.store.transition(
      { ...intentMove(n, version, state), atMs: instant },
      live(),
    );
    assert.ok(moved.ok);
  });
}

/** An intent's events written in one millisecond read back in the order they were written. */
async function readsEventsInWriteOrder(subject: IntentStoreSubject): Promise<void> {
  await createAt(subject, 1, instant);
  await moveAt(subject, 1, ["checked", "quoted", "assessed", "awaiting_confirmation"]);
  const events = await subject.store.events(fixtureId("int", 1), live());
  assert.deepEqual(
    events.map((event) => event.toState),
    ["proposed", "checked", "quoted", "assessed", "awaiting_confirmation"],
  );
  assert.deepEqual(
    events.map((event) => event.id),
    events.map((event) => event.id).toSorted((a, b) => a - b),
  );
}

/** Intents first confirmed in one millisecond come back in id order, whatever order they moved. */
async function breaksConfirmedTiesById(subject: IntentStoreSubject): Promise<void> {
  await inOrder([3, 1, 2], async (n) => {
    await createAt(subject, n, instant - 1);
    await moveAt(subject, n, ["confirmed"]);
  });
  const confirmed = await subject.store.confirmedSince(
    { agentId: subject.agentId, isPaper: true, fromMs: 0 },
    live(),
  );
  assert.deepEqual(
    confirmed.map((intent) => [intent.intentId, intent.confirmedAtMs]),
    [1, 2, 3].map((n) => [fixtureId("int", n), instant]),
  );
}

function infoAs(symbol: string) {
  return { symbol, name: symbol, decimals: 18, verified: false };
}

/**
 * Of intents created in one millisecond, the one with the greater id holds a token's newest facts:
 * one token's pair is written in id order and the other's against it, so neither the first nor
 * the last written passes for both.
 */
async function breaksAssetTiesById(subject: IntentStoreSubject): Promise<void> {
  const xvs = assetRefSchema.parse("fake:1/token:0x0000000f");
  const cake = assetRefSchema.parse("fake:1/token:0x0000000c");
  const writes = [
    { n: 1, asset: xvs },
    { n: 2, asset: xvs },
    { n: 4, asset: cake },
    { n: 3, asset: cake },
  ] as const;
  await inOrder(writes, async ({ n, asset }) => {
    const assets = { [asset]: infoAs(`T${String(n)}.${asset.slice(-1)}`) };
    const draft = { ...intentDraft(subject, n), atMs: instant, assets };
    assert.ok((await subject.store.create(draft, live())).ok);
  });
  assert.deepEqual(await subject.store.storedAssets([xvs, cake], live()), {
    [xvs]: infoAs("T2.f"),
    [cake]: infoAs("T4.c"),
  });
}

/** The intent store's checks of order among rows of one millisecond. */
export function intentOrderChecks(
  create: () => Promise<IntentStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "reads an intent's events of one millisecond in write order",
      create,
      readsEventsInWriteOrder,
    ),
    checkOn("lists intents confirmed in one millisecond by id", create, breaksConfirmedTiesById),
    checkOn(
      "takes a token's facts from the greater id of one millisecond",
      create,
      breaksAssetTiesById,
    ),
  ];
}
