import {
  type AccountRef,
  accountRefSchema,
  chainRefSchema,
  createChainRegistry,
  type WalletRole,
} from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigner,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { createIdSource, err, type Id, type JsonValue } from "@binference/core";
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

// The calls a launch wallet makes on the test agent's one venue, `fake-swap`: a create call and a
// buy; and the deposit a bridge wallet makes on `fake-bridge`, a venue the agent does not use.
const createCall = { type: "function", name: "create", inputs: [] };
const buyCall = { type: "function", name: "buy", inputs: [] };
const depositCall = { type: "function", name: "deposit", inputs: [] };
const roleCalls: Readonly<Record<WalletRole, readonly [string, readonly JsonValue[]]>> = {
  launch: ["fake-swap", [createCall, buyCall]],
  bridge: ["fake-bridge", [depositCall]],
};
const launchHost = {
  roleWalletCalls: (role: WalletRole, venues?: readonly string[]) => {
    const [venue, calls] = roleCalls[role];
    return venues === undefined || venues.includes(venue) ? calls : [];
  },
};

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
    host: launchHost,
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
  it("lists an agent's wallets, default first, each with its account and chain from custody", async () => {
    const list = await walletList(everyAccount);
    expect(expectOk(await list(testCall({ agent: testAgent })))).toStrictEqual({
      items: [
        {
          wallet: main.id,
          agent: testAgent,
          address: accounts.main,
          chainName: "Fake One",
          label: "Main",
          createdAt: 10,
        },
        {
          wallet: spare.id,
          agent: testAgent,
          address: accounts.spare,
          chainName: "Fake Two",
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

  it("names the calls the agent's launch wallet's ceiling lacks, and none for an extra one", async () => {
    const launch = testWalletRecord({
      id: fixtureId("wal", 44),
      agentId: testAgent,
      label: "Launches",
      createdAtMs: 40,
      role: "launch",
    });
    // An older ceiling: its rules hold the buy, made before the launchpad declared its create call.
    const older = { ...launch, ceiling: { ...launch.ceiling, policy: [{ abi: [buyCall] }] } };
    const extra = { ...older, id: fixtureId("wal", 45), createdAtMs: 35 };
    const accountsWithLaunch = new Map([
      ...everyAccount,
      [older.id, accounts.main],
      [extra.id, accounts.others],
    ]);
    const list = await walletList(accountsWithLaunch, [main, older, extra]);
    const { items } = expectOk(await list(testCall({ agent: testAgent })));
    // The store names one of the two the agent's launch wallet; the other is an extra one.
    const launchViews = items.filter((view) => view.role === "launch");
    expect(launchViews.map((view) => [view.missingCalls, view.extra])).toStrictEqual(
      expect.arrayContaining([
        [["create"], undefined],
        [undefined, true],
      ]),
    );
    expect(launchViews).toHaveLength(2);
    expect(items[0]?.missingCalls).toBeUndefined();
  });

  it("names the calls the agent's bridge wallet's ceiling lacks, and marks an extra one", async () => {
    const bridge = testWalletRecord({
      id: fixtureId("wal", 46),
      agentId: testAgent,
      label: "Bridges",
      createdAtMs: 40,
      role: "bridge",
    });
    const extra = { ...bridge, id: fixtureId("wal", 47), createdAtMs: 45 };
    const held = new Map([
      ...everyAccount,
      [bridge.id, accounts.spare],
      [extra.id, accounts.others],
    ]);
    const list = await walletList(held, [main, bridge, extra]);
    const { items } = expectOk(await list(testCall({ agent: testAgent })));

    expect(
      items.map((view) => [view.label, view.bridge, view.missingCalls, view.extra]),
    ).toStrictEqual([
      ["Main", undefined, undefined, undefined],
      ["Bridges", true, ["deposit"], undefined],
      ["Bridges", true, undefined, true],
    ]);
  });
});
