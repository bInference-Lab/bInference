import assert from "node:assert/strict";
import { accountRefSchema, chainRefSchema, isTxHash } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { IdentityRecord } from "../identity/identity-record.js";
import type { IdentityStore } from "../identity/ports.js";
import { intentDraft, intentMove, type IntentStoreSubject } from "./intent-fixtures.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** An identity store under test, beside the intent store of the same database that writes it. */
export interface IdentityStoreSubject extends IntentStoreSubject {
  readonly identities: IdentityStore;
}

/** Makes a fresh, empty identity store and intent store for each check. */
export interface IdentityStoreHarness {
  create(): Promise<IdentityStoreSubject>;
}

const txHash = "0x0000000000000000000000000000000000000000000000000000000000000abc";

/** The subject's agent's identity with the registry's id `onchainId`, registered at 5000. */
export function identityOf(
  subject: Pick<IdentityStoreSubject, "agentId">,
  onchainId: string,
): IdentityRecord {
  if (!isTxHash(txHash)) {
    throw new Error("The fixture hash is malformed.");
  }
  return {
    agentId: subject.agentId,
    chain: chainRefSchema.parse("fake:1"),
    registry: accountRefSchema.parse("fake:1:0x000000e1"),
    onchainId,
    txHash,
    registeredAtMs: 5_000,
    file: "data:application/json;base64,e30=",
  };
}

// A move that carries an identity stores it with the move, and the store reads it by the agent.
async function readsWhatAMoveStored(subject: IdentityStoreSubject): Promise<void> {
  const { identities, store, agentId } = subject;
  assert.equal(await identities.get(agentId, live()), undefined);
  await store.create(intentDraft(subject, 1), live());
  const identity = identityOf(subject, "340282366920938463463374607431768211457");
  assert.ok((await store.transition({ ...intentMove(1, 0, "checked"), identity }, live())).ok);
  assert.deepEqual(await identities.get(agentId, live()), identity);
  assert.equal(await identities.get(fixtureId("agt", 9), live()), undefined);
}

// A second identity for the agent makes its move stale and writes nothing, its move included.
async function keepsOnePerAgent(subject: IdentityStoreSubject): Promise<void> {
  const { identities, store, agentId } = subject;
  await store.create(intentDraft(subject, 1), live());
  await store.create(intentDraft(subject, 2), live());
  const identity = identityOf(subject, "42");
  await store.transition({ ...intentMove(1, 0, "checked"), identity }, live());
  const again = { ...intentMove(2, 0, "checked"), identity: identityOf(subject, "43") };
  assert.deepEqual(await store.transition(again, live()), { ok: false, error: "stale" });
  assert.equal((await store.get(fixtureId("int", 2), live()))?.state, "proposed");
  assert.equal((await store.events(fixtureId("int", 2), live())).length, 1);
  assert.deepEqual(await identities.get(agentId, live()), identity);
}

async function refusesAborted(subject: IdentityStoreSubject): Promise<void> {
  await assertRefusesAborted(async (call) => subject.identities.get(subject.agentId, call));
}

/** The contract every `IdentityStore` adapter passes. */
export function identityStoreContract(harness: IdentityStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<IdentityStoreSubject> => harness.create();
  return [
    checkOn("reads the identity a move stored, by its agent", create, readsWhatAMoveStored),
    checkOn(
      "keeps one identity per agent, a second move stale and nothing more written",
      create,
      keepsOnePerAgent,
    ),
    checkOn("refuses a read on an aborted signal", create, refusesAborted),
  ];
}
