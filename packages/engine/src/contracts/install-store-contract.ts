import assert from "node:assert/strict";
import { accountRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { InstallSetup, WalletDraft } from "../install/install-record.js";
import type { InstallStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** An install store under test, an agent its wallets may belong to, and a family it takes. */
export interface InstallStoreSubject {
  readonly store: InstallStore;
  readonly agent: Id<"agt">;
  /** A chain family the store's wallets may have. */
  readonly family: string;
}

/** Makes a fresh install store, with no install id, custody or wallet, for each check. */
export interface InstallStoreHarness {
  create(): Promise<InstallStoreSubject>;
}

// 2^64 + 1 does not fit a SQLite integer: the cap must round-trip as decimal text.
const beyond64Bits = 2n ** 64n + 1n;

function wallet(subject: InstallStoreSubject, n: number): WalletDraft {
  return {
    id: fixtureId("wal", n),
    agentId: subject.agent,
    family: subject.family,
    custody: "privy",
    custodyWalletId: `privy-wallet-${String(n)}`,
    policyId: `privy-policy-${String(n)}`,
    signerId: "privy-agent-quorum",
    address: `0x${n.toString(16).padStart(40, "a")}`,
    label: `wallet ${String(n)}`,
    createdAtMs: 1_000 * n,
    ceiling: {
      policyId: `privy-policy-${String(n)}`,
      policy: [{ name: "Contract calls", action: "ALLOW" }],
      perTxNativeBase: beyond64Bits + BigInt(n),
      readAtMs: 1_000 * n + 1,
    },
  };
}

function setup(subject: InstallStoreSubject, n: number, isStartOver = false): InstallSetup {
  return {
    atMs: 1_000 * n,
    custody: {
      provider: "privy",
      appId: `app-${String(n)}`,
      ownerQuorumId: `owner-quorum-${String(n)}`,
      ownerKeyPublic: "b3duZXIga2V5",
      agentQuorumId: "privy-agent-quorum",
      agentKeyPublic: "YWdlbnQga2V5",
      attachedAtMs: 1_000 * n,
    },
    rescueAddress: accountRefSchema.parse(`fake:1:0x${String(n).repeat(40).slice(0, 40)}`),
    wallet: wallet(subject, n),
    isStartOver,
  };
}

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

async function refusesAbortedCalls(subject: InstallStoreSubject): Promise<void> {
  const { store } = subject;
  await assertRefusesAborted(async (call) =>
    store.installId({ id: fixtureId("ins", 1), atMs: 1 }, call),
  );
  await assertRefusesAborted(async (call) => store.read(call));
  await assertRefusesAborted(async (call) => store.setUp(setup(subject, 1), call));
  assert.deepEqual(await store.read(live()), { wallets: [] });
}

/** The contract every {@link InstallStore} adapter passes. */
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
    checkOn("refuses every call on an aborted signal", create, refusesAbortedCalls),
  ];
}
