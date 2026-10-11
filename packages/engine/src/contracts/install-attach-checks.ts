import assert from "node:assert/strict";
import { ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { type InstallStoreSubject, setup, wallet } from "./install-store-setups.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

const attachment = {
  agentQuorumId: "new-agent-quorum",
  agentKeyPublic: "bmV3IGtleQ==",
  atMs: 9_000,
};

async function attachesEveryLiveWallet(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.setUp(setup(subject, 1), live());
  const second = setup(subject, 2, true);
  await store.setUp(second, live());
  await store.createWallet(wallet(subject, 3), live());
  const before = await store.read(live());

  assert.deepEqual(await store.attach(attachment, live()), ok(undefined));

  const after = await store.read(live());
  assert.deepEqual(after.custody, {
    ...second.custody,
    agentQuorumId: attachment.agentQuorumId,
    agentKeyPublic: attachment.agentKeyPublic,
    attachedAtMs: attachment.atMs,
  });
  const signers = after.wallets.map((item) => [item.id, item.signerId, item.archivedAtMs]);
  const expected = before.wallets.map((item) => [
    item.id,
    item.archivedAtMs === undefined ? attachment.agentQuorumId : item.signerId,
    item.archivedAtMs,
  ]);
  assert.deepEqual(signers, expected);
  assert.deepEqual({ ...after, custody: before.custody, wallets: before.wallets }, before);
}

async function refusesBeforeSetUp({ store }: InstallStoreSubject): Promise<void> {
  assert.deepEqual(await store.attach(attachment, live()), { ok: false, error: "not_set_up" });
  assert.deepEqual(await store.read(live()), { wallets: [] });
  await assertRefusesAborted(async (call) => store.attach(attachment, call));
}

async function keepsTheSealKey(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  const key = { sealKeyPublic: "c2VhbGluZyBrZXk=" };
  assert.deepEqual(await store.setSealKey(key, live()), { ok: false, error: "not_set_up" });
  const first = setup(subject, 1);
  await store.setUp(first, live());
  const before = await store.read(live());

  assert.deepEqual(await store.setSealKey(key, live()), ok(undefined));

  const after = await store.read(live());
  assert.deepEqual(after, { ...before, custody: { ...first.custody, ...key } });
  await store.attach(attachment, live());
  assert.equal((await store.read(live())).custody?.sealKeyPublic, key.sealKeyPublic);
  await assertRefusesAborted(async (call) => store.setSealKey(key, call));
}

/** The install store's checks of an agent key attached to every live wallet. */
export function attachChecks(create: () => Promise<InstallStoreSubject>): readonly ContractCheck[] {
  return [
    checkOn(
      "attaches a new agent key to the custody and every live wallet, never an archived one",
      create,
      attachesEveryLiveWallet,
    ),
    checkOn(
      "refuses to attach an agent key before the install is set up",
      create,
      refusesBeforeSetUp,
    ),
    checkOn(
      "keeps the sealing key's public half once set up, and through an attach",
      create,
      keepsTheSealKey,
    ),
  ];
}
