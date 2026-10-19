import { type AccountRef, accountRefParts } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { alertOf, walletCondition } from "../contracts/alert-fire-checks.js";
import { fixtureId, inOrder, live } from "../contracts/store-fixtures.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
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
});
