import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { WalletRecord } from "../agents/wallet-record.js";
import type { WalletStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh store for each check that holds the wallets given, and their agents. */
export interface WalletStoreHarness {
  create(wallets: readonly WalletRecord[]): Promise<WalletStore>;
}

const first = fixtureId("agt", 31);
const second = fixtureId("agt", 32);

// Stored out of order: the first agent's default wallet is its oldest, made last of the three.
const stored: readonly WalletRecord[] = [
  { id: fixtureId("wal", 33), agentId: first, label: "Trading", createdAtMs: 3_000 },
  {
    id: fixtureId("wal", 32),
    agentId: second,
    label: "Old",
    createdAtMs: 2_000,
    archivedAtMs: 2_500,
  },
  { id: fixtureId("wal", 31), agentId: first, label: "Main", createdAtMs: 1_000 },
];

function byId(n: number): WalletRecord {
  const wallet = stored.find((record) => record.id === fixtureId("wal", n));
  assert.ok(wallet !== undefined);
  return wallet;
}

/** The contract every `WalletStore` adapter passes. */
export function walletStoreContract(harness: WalletStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<WalletStore> => harness.create(stored);
  return [
    checkOn("lists an agent's wallets oldest first, its default first", create, async (store) => {
      assert.deepEqual(await store.list({ agentId: first }, live()), [byId(31), byId(33)]);
    }),
    checkOn(
      "lists every agent's wallets, oldest first, when no agent is named",
      create,
      async (store) => {
        assert.deepEqual(await store.list({}, live()), [byId(31), byId(32), byId(33)]);
      },
    ),
    checkOn("keeps an archived wallet with the time it was archived", create, async (store) => {
      assert.deepEqual(await store.list({ agentId: second }, live()), [byId(32)]);
    }),
    checkOn("lists no wallet for an agent without one", create, async (store) => {
      assert.deepEqual(await store.list({ agentId: fixtureId("agt", 39) }, live()), []);
    }),
    checkOn("refuses to read on an aborted signal", create, async (store) => {
      await assertRefusesAborted(async (options) => store.list({}, options));
    }),
  ];
}
