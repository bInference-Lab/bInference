import { type AccountRef, accountRefParts } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { alertOf, walletCondition } from "../contracts/alert-fire-checks.js";
import { orderDraft } from "../contracts/order-fixtures.js";
import { fixtureId, inOrder, live } from "../contracts/store-fixtures.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testAgentDraft, testWallet } from "../intents/test-intents.js";
import { testCopy } from "../orders/test-orders.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { tellOverflows } from "./overflow-notices.js";

const dayMs = 86_400_000;

function accountOf(n: number): AccountRef {
  const condition = walletCondition(n);
  if (condition.kind !== "wallet") {
    throw new Error("Not a wallet condition.");
  }
  return condition.account;
}

// The stores with wallets 1 and 2 tracked by the test agent's alerts, wallet 1 saved in its
// address book as Whale; cuts wallet 1's blocks 2 and 3 and wallet 2's block 3.
async function cutWallets() {
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft(), live());
  const subject = {
    agentIds: [testAgent, testAgent] as const,
    agentInbox: stores.agentInbox,
    archive: async () => Promise.resolve(),
  };
  await inOrder([1, 2], async (n) =>
    stores.alerts.create(alertOf({ ...subject, alerts: stores.alerts }, n), live()),
  );
  const whale = {
    id: fixtureId("adr", 1),
    agentId: testAgent,
    account: accountOf(1),
    recipientBytes: accountRefParts(accountOf(1)).address.toLowerCase(),
    label: "Whale",
  };
  await stores.agents.addAddress({ ...whale, usableAtMs: 0, createdAtMs: 0 }, live());
  await stores.trackedWallets.record(
    {
      chain: accountRefParts(accountOf(1)).chain,
      from: 1n,
      to: 3n,
      toHash: "0x03",
      atMs: 3_000,
      wallets: [1, 2].map((n) => ({ account: accountOf(n), sinceBlock: 1n, readFrom: 1n })),
      trades: [],
      overflows: [
        { account: accountOf(1), block: 2n },
        { account: accountOf(1), block: 3n },
        { account: accountOf(2), block: 3n },
      ],
    },
    live(),
  );
  return stores;
}

describe("the notices of cut blocks", () => {
  it("tells each wallet's cut blocks once a day, by its label or its short address", async () => {
    const stores = await cutWallets();
    const clock = createManualClock(10_000);
    const pushes: EnginePush[] = [];
    const parts = { ...stores, clock, publish: (push: EnginePush) => pushes.push(push) };
    await expect(tellOverflows(parts, live())).resolves.toBe(2);
    expect(pushes.map(({ data }) => data)).toStrictEqual([
      { key: "notice.walletOverflow", values: { wallet: "Whale", blocks: "2" } },
      { key: "notice.walletOverflow", values: { wallet: "0x0000…0002", blocks: "1" } },
    ]);
    await expect(tellOverflows(parts, live())).resolves.toBe(0);
    await clock.advance(dayMs);
    await expect(tellOverflows(parts, live())).resolves.toBe(0);
  });

  it("names a wallet by the alerts that track it, never by an order that follows no leader", async () => {
    const stores = await cutWallets();
    const pair = { agentId: testAgent, walletId: testWallet };
    stores.install.addWallet(
      testWalletRecord({ id: testWallet, ...pair, label: "main", createdAtMs: 1 }),
    );
    const limit = orderDraft(pair, 1);
    expect((await stores.orders.create(limit, live())).ok).toBe(true);
    const pushes: EnginePush[] = [];
    const clock = createManualClock(10_000);
    const parts = { ...stores, clock, publish: (push: EnginePush) => pushes.push(push) };
    await expect(tellOverflows(parts, live())).resolves.toBe(2);
    expect(pushes.map(({ data }) => data)).toStrictEqual([
      { key: "notice.walletOverflow", values: { wallet: "Whale", blocks: "2" } },
      { key: "notice.walletOverflow", values: { wallet: "0x0000…0002", blocks: "1" } },
    ]);
  });

  it("names a wallet a copy order follows by the label its agent saved", async () => {
    const stores = await cutWallets();
    const pair = { agentId: testAgent, walletId: testWallet };
    stores.install.addWallet(
      testWalletRecord({ id: testWallet, ...pair, label: "main", createdAtMs: 1 }),
    );
    const leader = accountOf(3);
    const trigger = { ...testCopy().trigger, leader };
    const copy = { ...orderDraft(pair, 1), request: testCopy({ trigger }) };
    expect((await stores.orders.create(copy, live())).ok).toBe(true);
    const saved = {
      id: fixtureId("adr", 3),
      agentId: testAgent,
      account: leader,
      recipientBytes: accountRefParts(leader).address.toLowerCase(),
      label: "Leader",
    };
    await stores.agents.addAddress({ ...saved, usableAtMs: 0, createdAtMs: 0 }, live());
    await stores.trackedWallets.record(
      {
        chain: accountRefParts(leader).chain,
        from: 4n,
        to: 4n,
        toHash: "0x04",
        atMs: 4_000,
        wallets: [{ account: leader, sinceBlock: 4n, readFrom: 4n }],
        trades: [],
        overflows: [{ account: leader, block: 4n }],
      },
      live(),
    );
    const pushes: EnginePush[] = [];
    const clock = createManualClock(10_000);
    const parts = { ...stores, clock, publish: (push: EnginePush) => pushes.push(push) };
    await tellOverflows(parts, live());
    expect(pushes.map(({ data }) => data)).toContainEqual({
      key: "notice.walletOverflow",
      values: { wallet: "Leader", blocks: "1" },
    });
  });
});
