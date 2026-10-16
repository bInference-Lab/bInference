import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type InstallStoreSubject, setup } from "./install-store-setups.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

const first = { version: 1, acceptedAtMs: 2_000 };
const second = { version: 2, acceptedAtMs: 3_000 };

async function keepsTheNewestAccepted({ store }: InstallStoreSubject): Promise<void> {
  assert.equal((await store.read(live())).disclaimer, undefined);
  await store.acceptDisclaimer(first, live());
  assert.deepEqual((await store.read(live())).disclaimer, first);

  await store.acceptDisclaimer(second, live());
  await store.acceptDisclaimer(first, live());
  await store.acceptDisclaimer({ ...second, acceptedAtMs: 4_000 }, live());

  assert.deepEqual((await store.read(live())).disclaimer, second);
  await assertRefusesAborted(async (call) => store.acceptDisclaimer(first, call));
}

async function keepsItThroughChanges(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.acceptDisclaimer(second, live());
  await store.setUp(setup(subject, 1), live());
  await store.setUp(setup(subject, 2, true), live());
  await store.changeRescue({ address: setup(subject, 3).rescueAddress, atMs: 5_000 }, live());
  assert.deepEqual((await store.read(live())).disclaimer, second);
}

/** The install store's checks of the disclaimer the owner accepted. */
export function disclaimerChecks(
  create: () => Promise<InstallStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "keeps the newest disclaimer accepted, never an older one, and not a second time",
      create,
      keepsTheNewestAccepted,
    ),
    checkOn(
      "keeps the accepted disclaimer through a setup and a start over",
      create,
      keepsItThroughChanges,
    ),
  ];
}
