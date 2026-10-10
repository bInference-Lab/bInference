import {
  type AccountRef,
  accountRefSchema,
  chainRefSchema,
  createChainRegistry,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { createIdSource, err, type Id } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakeCeilingEditor } from "../fakes/fake-ceiling-editor.js";
import { createFakeWalletMaker } from "../fakes/fake-wallet-maker.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryConfigJournal } from "../fakes/memory-config-journal.js";
import { createMemoryInstallStore } from "../fakes/memory-install-store.js";
import type { WalletRecord } from "../install/install-record.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testAgentDraft, testNowMs } from "../intents/test-intents.js";
import { testCall } from "./test-engine.js";
import { createWalletHandlers } from "./wallet-handlers.js";

const other = fixtureId("agt", 41);
const main = testWalletRecord({
  id: fixtureId("wal", 41),
  agentId: testAgent,
  label: "Main",
  createdAtMs: 10,
});
const spare = testWalletRecord({
  id: fixtureId("wal", 42),
  agentId: testAgent,
  label: "Spare",
  createdAtMs: 20,
  archivedAtMs: 30,
});
const others = testWalletRecord({
  id: fixtureId("wal", 43),
  agentId: other,
  label: "Other",
  createdAtMs: 15,
});
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
  const install = createMemoryInstallStore();
  stored.forEach((wallet) => install.addWallet(wallet));
  const clock = createManualClock(testNowMs);
  const handlers = createWalletHandlers({
    agents,
    install,
    custody: createFakeSigner(held),
    chains: twoChains(),
    // The wallet list makes no wallet: these parts of `wallet/create` stay untouched.
    ceilings: createFakeCeilingEditor({ clock }),
    maker: createFakeWalletMaker({ clock, chain: chainRefSchema.parse("fake:1"), family: "fake" }),
    journal: createMemoryConfigJournal(),
    clock,
    ids: createIdSource({ clock, random: createSeededRandom(1) }),
    publish: () => undefined,
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
