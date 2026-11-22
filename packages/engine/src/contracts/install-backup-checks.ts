import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type InstallStoreSubject, setup, wallet } from "./install-store-setups.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

async function readsWhatABackupTakes(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  assert.deepEqual(await store.readBackupFacts(live()), { wallets: [] });
  const first = setup(subject, 1);
  const again = setup(subject, 2, true);
  const third = wallet(subject, 3);
  const sealKeyPublic = "c2VhbGluZyBrZXk=";
  await store.setUp(first, live());
  await store.setUp(again, live());
  await store.createWallet(third, live());
  const custody = {
    appId: again.custody.appId,
    ownerKeyPublic: again.custody.ownerKeyPublic,
    attachedAtMs: again.custody.attachedAtMs,
  };
  const wallets = [
    { custodyWalletId: first.wallet.custodyWalletId, archivedAtMs: again.atMs },
    { custodyWalletId: again.wallet.custodyWalletId },
    { custodyWalletId: third.custodyWalletId },
  ];

  assert.deepEqual(await store.readBackupFacts(live()), { custody, wallets });
  await store.setSealKey({ sealKeyPublic }, live());
  assert.deepEqual(await store.readBackupFacts(live()), {
    custody: { ...custody, sealKeyPublic },
    wallets,
  });
  await assertRefusesAborted(async (call) => store.readBackupFacts(call));
}

/** The install store's checks of what a backup reads of the install. */
export function backupFactsChecks(
  create: () => Promise<InstallStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "reads the custody and the wallets a backup takes, archived wallets too, oldest first",
      create,
      readsWhatABackupTakes,
    ),
  ];
}
