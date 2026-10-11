import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { BackupRecord } from "../backups/backup-record.js";
import type { BackupStore } from "../backups/ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh, empty {@link BackupStore} for each check. */
export interface BackupStoreHarness {
  create(): Promise<BackupStore>;
}

function backupOf(n: number, createdAtMs: number): BackupRecord {
  return {
    id: fixtureId("bkp", n),
    path: `/state/backups/backup-${String(n)}.bnfbak`,
    bytes: 4_096 * n,
    kind: n % 2 === 0 ? "weekly" : "daily",
    createdAtMs,
  };
}

async function listsOldestFirst(store: BackupStore): Promise<void> {
  const [early, late, tied] = [backupOf(1, 1_000), backupOf(2, 3_000), backupOf(3, 1_000)];
  await store.record(late, live());
  await store.record(tied, live());
  await store.record(early, live());
  assert.deepEqual(await store.list(live()), [early, tied, late]);
}

async function marksVerified(store: BackupStore): Promise<void> {
  const backup = backupOf(1, 1_000);
  await store.record(backup, live());
  assert.deepEqual(await store.markVerified({ id: backup.id, atMs: 2_000 }, live()), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(await store.list(live()), [{ ...backup, verifiedAtMs: 2_000 }]);
  const unknown = { id: fixtureId("bkp", 9), atMs: 2_000 };
  assert.deepEqual(await store.markVerified(unknown, live()), { ok: false, error: "not_found" });
}

async function refusesAnIdInUse(store: BackupStore): Promise<void> {
  const backup = backupOf(1, 1_000);
  await store.record(backup, live());
  await assert.rejects(store.record({ ...backup, path: "/other" }, live()), {
    code: "store.constraint",
  });
  assert.deepEqual(await store.list(live()), [backup]);
}

async function forgetsOnlyTheIdsGiven(store: BackupStore): Promise<void> {
  const [first, second] = [backupOf(1, 1_000), backupOf(2, 2_000)];
  await store.record(first, live());
  await store.record(second, live());
  await store.forget([first.id, fixtureId("bkp", 9)], live());
  assert.deepEqual(await store.list(live()), [second]);
  await store.forget([], live());
  assert.deepEqual(await store.list(live()), [second]);
}

async function refusesAborted(store: BackupStore): Promise<void> {
  const backup = backupOf(1, 1_000);
  await assertRefusesAborted(async (options) => store.record(backup, options));
  await assertRefusesAborted(async (options) =>
    store.markVerified({ id: backup.id, atMs: 1 }, options),
  );
  await assertRefusesAborted(async (options) => store.list(options));
  await assertRefusesAborted(async (options) => store.forget([backup.id], options));
  assert.deepEqual(await store.list(live()), []);
}

async function keepsDigests(store: BackupStore): Promise<void> {
  const backup: BackupRecord = {
    ...backupOf(1, 1_000),
    fileSha256: "a".repeat(64),
    headerSha256: "b".repeat(64),
  };
  await store.record(backup, live());
  await store.record(backupOf(2, 2_000), live());
  assert.deepEqual(await store.list(live()), [backup, backupOf(2, 2_000)]);
}

/** The contract every `BackupStore` adapter passes. */
export function backupStoreContract(harness: BackupStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<BackupStore> => harness.create();
  return [
    checkOn("lists every backup oldest first, then by id", create, listsOldestFirst),
    checkOn(
      "marks a backup verified, and answers not_found for one it lacks",
      create,
      marksVerified,
    ),
    checkOn(
      "refuses a second backup with an id in use, and keeps the first",
      create,
      refusesAnIdInUse,
    ),
    checkOn("forgets only the backups whose ids it is given", create, forgetsOnlyTheIdsGiven),
    checkOn(
      "keeps a backup's file and header digests, and none it was not given",
      create,
      keepsDigests,
    ),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
