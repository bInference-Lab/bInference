import assert from "node:assert/strict";
import { type AccountRef, accountRefSchema } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { attachChecks } from "./install-attach-checks.js";
import {
  type InstallStoreHarness,
  type InstallStoreSubject,
  setup,
  wallet,
} from "./install-store-setups.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

async function keepsTheFirstInstallId({ store }: InstallStoreSubject): Promise<void> {
  const first = { id: fixtureId("ins", 1), atMs: 1 };
  assert.equal(await store.installId(first, live()), first.id);
  assert.equal(await store.installId({ id: fixtureId("ins", 2), atMs: 2 }, live()), first.id);
}

async function setsUpTheFirstWallet(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  assert.deepEqual(await store.read(live()), { wallets: [] });
  const first = setup(subject, 1);
  assert.deepEqual(await store.setUp(first, live()), { ok: true, value: undefined });
  assert.deepEqual(await store.read(live()), {
    custody: first.custody,
    rescueAddress: first.rescueAddress,
    wallets: [first.wallet],
  });
}

async function refusesASecondSetup(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.setUp(setup(subject, 1), live());
  const before = await store.read(live());
  assert.deepEqual(await store.setUp(setup(subject, 2), live()), {
    ok: false,
    error: "set_up",
  });
  assert.deepEqual(await store.read(live()), before);
}

async function startsOver(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  const first = setup(subject, 1);
  await store.setUp(first, live());
  const again = setup(subject, 2, true);
  assert.deepEqual(await store.setUp(again, live()), { ok: true, value: undefined });
  assert.deepEqual(await store.read(live()), {
    custody: again.custody,
    rescueAddress: again.rescueAddress,
    wallets: [{ ...first.wallet, archivedAtMs: again.atMs }, again.wallet],
  });
}

async function refusesAHeldWallet(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  const first = setup(subject, 1);
  await store.setUp(first, live());
  const sameWallet = {
    ...setup(subject, 2, true),
    wallet: { ...wallet(subject, 2), address: first.wallet.address },
  };
  await assert.rejects(store.setUp(sameWallet, live()));
  assert.deepEqual((await store.read(live())).custody, first.custody);
}

function rescue(n: number): AccountRef {
  return accountRefSchema.parse(`fake:1:0x${String(n).repeat(40).slice(0, 40)}`);
}

async function waitsForANewRescueAddress(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  const first = setup(subject, 1);
  await store.setUp(first, live());
  const pendingRescue = { address: rescue(7), atMs: 10_000 + looseningWaitMs };
  const waiting = { rescueAddress: first.rescueAddress, pendingRescue };
  assert.deepEqual(await store.changeRescue({ address: rescue(7), atMs: 10_000 }, live()), {
    before: { rescueAddress: first.rescueAddress },
    after: waiting,
  });
  assert.deepEqual(await store.read(live()), {
    custody: first.custody,
    ...waiting,
    wallets: [first.wallet],
  });
  assert.deepEqual(await store.cancelRescueChange(20_000, live()), {
    before: waiting,
    after: { rescueAddress: first.rescueAddress },
  });
  assert.deepEqual((await store.read(live())).pendingRescue, undefined);
}

async function paysANewRescueAddressFromItsTime(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.setUp(setup(subject, 1), live());
  await store.changeRescue({ address: rescue(7), atMs: 10_000 }, live());
  const later = { address: rescue(8), atMs: 10_000 + looseningWaitMs };
  assert.deepEqual(await store.changeRescue(later, live()), {
    before: { rescueAddress: rescue(7) },
    after: {
      rescueAddress: rescue(7),
      pendingRescue: { address: rescue(8), atMs: later.atMs + looseningWaitMs },
    },
  });
  const again = setup(subject, 2, true);
  await store.setUp(again, live());
  const read = await store.read(live());
  assert.deepEqual([read.rescueAddress, read.pendingRescue], [again.rescueAddress, undefined]);
}

const signedChange = (untilMs: number) => ({ untilMs, payload: { signed: [String(untilMs)] } });

async function keepsCeilingChanges(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.setUp(setup(subject, 1), live());
  const ceiling = { onEffect: signedChange(1), onCancel: signedChange(2) };
  await store.changeRescue({ address: rescue(7), atMs: 10_000, ceiling }, live());
  assert.deepEqual((await store.read(live())).rescueCeiling, ceiling);
  const again = { address: rescue(7), atMs: 20_000, ceiling: { onEffect: signedChange(3) } };
  await store.changeRescue(again, live());
  assert.deepEqual((await store.read(live())).rescueCeiling, ceiling);
  const cancelled = await store.cancelRescueChange(30_000, live());
  assert.deepEqual(cancelled.dropped, ceiling);
  assert.equal((await store.read(live())).rescueCeiling, undefined);
  await store.changeRescue({ address: rescue(8), atMs: 40_000, ceiling }, live());
  await store.clearRescueCeiling(live());
  const read = await store.read(live());
  assert.deepEqual([read.rescueCeiling, read.pendingRescue?.address], [undefined, rescue(8)]);
  await store.changeRescue({ address: rescue(9), atMs: 50_000, ceiling }, live());
  await store.changeRescue({ address: read.rescueAddress ?? rescue(1), atMs: 60_000 }, live());
  assert.equal((await store.read(live())).rescueCeiling, undefined);
}

async function storesANewWallet(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  const first = setup(subject, 2);
  await store.setUp(first, live());
  const made = wallet(subject, 1);
  await store.createWallet(made, live());
  assert.deepEqual((await store.read(live())).wallets, [made, first.wallet]);
  await assert.rejects(
    store.createWallet({ ...wallet(subject, 3), address: made.address }, live()),
  );
  assert.deepEqual((await store.read(live())).wallets, [made, first.wallet]);
}

async function replacesKeptCeilingChanges(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await store.setUp(setup(subject, 1), live());
  await store.keepRescueCeiling({ onEffect: signedChange(1) }, live());
  assert.equal((await store.read(live())).rescueCeiling, undefined);
  const ceiling = { onEffect: signedChange(2), onCancel: signedChange(3) };
  await store.changeRescue({ address: rescue(7), atMs: 10_000, ceiling }, live());
  const resigned = { onEffect: signedChange(4) };
  await store.keepRescueCeiling(resigned, live());
  const read = await store.read(live());
  assert.deepEqual([read.rescueCeiling, read.pendingRescue?.address], [resigned, rescue(7)]);
}

async function updatesALiveCeiling(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  const first = setup(subject, 1);
  await store.setUp(first, live());
  const ceiling = {
    ...first.wallet.ceiling,
    policy: ["changed"],
    perTxNativeBase: 7n,
    readAtMs: 9,
  };
  const update = { wallet: first.wallet.id, ceiling };
  assert.deepEqual(await store.updateCeiling(update, live()), { ok: true, value: undefined });
  assert.deepEqual((await store.read(live())).wallets, [{ ...first.wallet, ceiling }]);
  const unknown = { ...update, wallet: fixtureId("wal", 9) };
  assert.deepEqual(await store.updateCeiling(unknown, live()), { ok: false, error: "not_found" });
  await store.setUp(setup(subject, 2, true), live());
  const archived = { ...update, ceiling: { ...ceiling, perTxNativeBase: 8n } };
  assert.deepEqual(await store.updateCeiling(archived, live()), { ok: false, error: "not_found" });
  const [kept] = (await store.read(live())).wallets;
  assert.deepEqual(kept?.ceiling, ceiling);
}

async function refusesAbortedCalls(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await assertRefusesAborted(async (call) =>
    store.installId({ id: fixtureId("ins", 1), atMs: 1 }, call),
  );
  await assertRefusesAborted(async (call) => store.read(call));
  await assertRefusesAborted(async (call) => store.setUp(setup(subject, 1), call));
  await assertRefusesAborted(async (call) =>
    store.changeRescue({ address: rescue(7), atMs: 1 }, call),
  );
  await assertRefusesAborted(async (call) => store.cancelRescueChange(1, call));
  await assertRefusesAborted(async (call) => store.clearRescueCeiling(call));
  await assertRefusesAborted(async (call) => store.keepRescueCeiling({}, call));
  await assertRefusesAborted(async (call) => store.createWallet(wallet(subject, 1), call));
  const update = { wallet: fixtureId("wal", 1), ceiling: wallet(subject, 1).ceiling };
  await assertRefusesAborted(async (call) => store.updateCeiling(update, call));
  assert.deepEqual(await store.read(live()), { wallets: [] });
}

/** The contract every `InstallStore` adapter passes. */
export function installStoreContract(harness: InstallStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<InstallStoreSubject> => harness.create();
  return [
    checkOn("keeps the first install id it is given", create, keepsTheFirstInstallId),
    checkOn(
      "sets up the custody, the rescue address and the first wallet",
      create,
      setsUpTheFirstWallet,
    ),
    checkOn("refuses a second setup and changes nothing", create, refusesASecondSetup),
    checkOn(
      "starts over: replaces the custody and the rescue address, archives the earlier wallets",
      create,
      startsOver,
    ),
    checkOn(
      "refuses a wallet whose address it holds, and changes nothing",
      create,
      refusesAHeldWallet,
    ),
    checkOn(
      "keeps a new rescue address waiting 24 hours until it is cancelled",
      create,
      waitsForANewRescueAddress,
    ),
    checkOn(
      "pays a new rescue address from its time on, and drops one that waits on a start over",
      create,
      paysANewRescueAddressFromItsTime,
    ),
    checkOn(
      "keeps the ceiling changes signed for a new rescue address while it waits",
      create,
      keepsCeilingChanges,
    ),
    checkOn("stores a new wallet beside the ones it holds", create, storesANewWallet),
    checkOn(
      "replaces the ceiling changes kept while a new rescue address waits",
      create,
      replacesKeptCeilingChanges,
    ),
    checkOn(
      "replaces a live wallet's copy of its ceiling, and no other wallet's",
      create,
      updatesALiveCeiling,
    ),
    ...attachChecks(create),
    checkOn("refuses every call on an aborted signal", create, refusesAbortedCalls),
  ];
}
