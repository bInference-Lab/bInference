import { type AccountRef, accountRefSchema, createChainRegistry } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { WalletRecord } from "../agents/wallet-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryWalletStore } from "../fakes/memory-wallet-store.js";
import { expectOk, testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall } from "./test-engine.js";
import { createWalletHandlers } from "./wallet-handlers.js";

const other = fixtureId("agt", 41);
const main: WalletRecord = {
  id: fixtureId("wal", 41),
  agentId: testAgent,
  label: "Main",
  createdAtMs: 10,
};
const spare: WalletRecord = {
  id: fixtureId("wal", 42),
  agentId: testAgent,
  label: "Spare",
  createdAtMs: 20,
  archivedAtMs: 30,
};
const others: WalletRecord = {
  id: fixtureId("wal", 43),
  agentId: other,
  label: "Other",
  createdAtMs: 15,
};
const accounts = {
  main: accountRefSchema.parse("fake:1:0x00000041"),
  spare: accountRefSchema.parse("fake:2:0x00000042"),
  others: accountRefSchema.parse("fake:1:0x00000043"),
};

// Two fake chains: the spare wallet has its account on the second only.
function twoChains() {
  const first = createFakeChainDefinition();
  return createChainRegistry({
    chains: [first, { ...first, id: "fake:2", key: "fake-two", name: "Fake Two" }],
    families: [createFakeFamily()],
    signingSchemes: [createFakeSigningScheme()],
  });
}

async function walletList(
  held: ReadonlyMap<Id<"wal">, AccountRef>,
  stored: readonly WalletRecord[] = [main, spare, others],
) {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), testCall({}));
  const wallets = createMemoryWalletStore();
  stored.forEach((wallet) => wallets.add(wallet));
  const handlers = createWalletHandlers({
    agents,
    wallets,
    custody: createFakeSigner(held),
    chains: twoChains(),
  });
  return handlers["wallet/list"];
}

const everyAccount = new Map([
  [main.id, accounts.main],
  [spare.id, accounts.spare],
  [others.id, accounts.others],
]);

describe("the wallet list", () => {
  it("lists an agent's wallets, default first, each with its account from custody", async () => {
    const list = await walletList(everyAccount);
    expect(expectOk(await list(testCall({ agent: testAgent })))).toStrictEqual({
      items: [
        { wallet: main.id, agent: testAgent, address: accounts.main, label: "Main", createdAt: 10 },
        {
          wallet: spare.id,
          agent: testAgent,
          address: accounts.spare,
          label: "Spare",
          createdAt: 20,
          archivedAt: 30,
        },
      ],
    });
  });

  it("lists every agent's wallets, oldest first, when the call names no agent", async () => {
    const list = await walletList(everyAccount);
    const { items } = expectOk(await list(testCall({})));
    expect(items.map((view) => [view.wallet, view.agent])).toStrictEqual([
      [main.id, testAgent],
      [others.id, other],
      [spare.id, testAgent],
    ]);
  });

  it("refuses an agent it does not know", async () => {
    const list = await walletList(everyAccount);
    await expect(list(testCall({ agent: fixtureId("agt", 49) }))).resolves.toStrictEqual(
      err("agent.not_found"),
    );
  });

  it("fails closed when custody holds a stored wallet on no chain", async () => {
    const list = await walletList(new Map([[main.id, accounts.main]]));
    await expect(list(testCall({ agent: testAgent }))).resolves.toStrictEqual(
      err("wallet.custody_down"),
    );
  });

  it("answers no wallet for an agent that has none", async () => {
    const list = await walletList(everyAccount, [others]);
    expect(expectOk(await list(testCall({ agent: testAgent })))).toStrictEqual({ items: [] });
  });
});
