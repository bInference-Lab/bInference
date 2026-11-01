import assert from "node:assert/strict";
import { type AccountRef, accountRefSchema } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { RescueReachRecord, RescueReachState } from "../install/rescue-record.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { type InstallStoreSubject, setup } from "./install-store-setups.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

// An account of the fake family on chain `chain`, whose address repeats the digit `n`, as the
// setups' rescue addresses do on chain 1.
function onChain(chain: number, n: number): AccountRef {
  return accountRefSchema.parse(`fake:${String(chain)}:0x${String(n).repeat(40).slice(0, 40)}`);
}

// A standing of agent `agent`'s rescue address `n` on chain `chain`.
function standing(
  agent: number,
  at: { readonly chain: number; readonly n: number },
  state: RescueReachState,
): RescueReachRecord {
  return { agent: fixtureId("agt", agent), account: onChain(at.chain, at.n), state };
}

async function keepsTheStandings(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.setUp(setup(subject, 1), live());
  const one = standing(1, { chain: 2, n: 1 }, "joined");
  const two = standing(2, { chain: 2, n: 1 }, "code");
  const atMs = 10_000;
  await store.keepRescueReach(
    { agents: [one.agent, two.agent], records: [one, two], atMs },
    live(),
  );
  await store.changeRescue({ address: onChain(1, 8), atMs }, live());
  const waiting = standing(1, { chain: 3, n: 8 }, "waiting");
  await store.keepRescueReach({ agents: [one.agent], records: [one, waiting], atMs }, live());
  assert.deepEqual((await store.read(live())).rescueReach, [two, one, waiting]);
  await store.keepRescueReach({ agents: [two.agent], records: [], atMs }, live());
  assert.deepEqual((await store.read(live())).rescueReach, [one, waiting]);
  const other = standing(3, { chain: 2, n: 9 }, "joined");
  await store.keepRescueReach({ agents: [other.agent], records: [other], atMs }, live());
  assert.deepEqual((await store.read(live())).rescueReach, [one, waiting]);
  // Once the new address took effect, the old one's standings go at the next change.
  const later = atMs + looseningWaitMs;
  await store.keepRescueReach({ agents: [], records: [], atMs: later }, live());
  assert.deepEqual((await store.read(live())).rescueReach, [waiting]);
  await store.setUp(setup(subject, 2, true), live());
  assert.equal((await store.read(live())).rescueReach, undefined);
}

async function refusesAbortedKeeps(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await assertRefusesAborted(async (call) =>
    store.keepRescueReach({ agents: [], records: [], atMs: 1 }, call),
  );
  assert.equal((await store.read(live())).rescueReach, undefined);
}

/** What the install store does with the rescue addresses' standings (decision 0321). */
export function rescueReachChecks(
  create: () => Promise<InstallStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "replaces an agent's standings of the rescue addresses, keeps the others' and forgets old ones",
      create,
      keepsTheStandings,
    ),
    checkOn("keeps no standing on an aborted signal", create, refusesAbortedKeeps),
  ];
}
