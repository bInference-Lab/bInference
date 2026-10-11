import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { AgentStore } from "../ports.js";
import { secondAgent } from "../safety/test-rescue.js";
import { saveTestAddress, sendRefusals, testSaved } from "../send-levels/test-sends.js";

const live = { signal: new AbortController().signal };
const chain = chainRefSchema.parse("fake:1");
const owner: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
const pending: AccountRef = accountRefSchema.parse("fake:1:0x000000a2");
const cold: AccountRef = accountRefSchema.parse("fake:1:0x000000f3");
const unknownAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 3 * looseningWaitMs,
});
// Another agent's wallet: an address saved for the test agent never reaches its ceiling.
const otherWallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c2"),
  agentId: secondAgent,
  label: "second",
  createdAtMs: testNowMs - 3 * looseningWaitMs,
});

function add(
  test: TestEngine,
  args: { readonly address?: string; readonly ownerKey?: string; readonly agent?: string } = {},
) {
  const { address = "0x000000f3", ownerKey = fakeOwnerKeyCode, agent = testAgent } = args;
  const call = { agent: idSchema("agt").parse(agent), chain, address, label: "cold", ownerKey };
  return test.engine.handlers["address/add"](testCall(call));
}

// The test engine with the owner's rescue address in effect, and two agents' live wallets whose
// ceilings list it.
async function withCeilings(): Promise<TestEngine> {
  const test = await startTestEngine();
  await test.stores.install.changeRescue(
    { address: owner, atMs: testNowMs - 3 * looseningWaitMs },
    live,
  );
  test.stores.install.addWallet(wallet);
  test.stores.install.addWallet(otherWallet);
  test.ceilings.put(wallet.policyId, [owner]);
  test.ceilings.put(otherWallet.policyId, [owner]);
  return test;
}

// An agent store where another call saves each address first, so this write finds it held.
function savedFirst(store: AgentStore): AgentStore {
  return {
    ...store,
    async addAddress(entry, call) {
      expectOk(await store.addAddress({ ...entry, label: "first" }, call));
      return err("exists");
    },
  };
}

// An agent store that refuses every address as held while it holds none.
function refusingUnheld(store: AgentStore): AgentStore {
  return { ...store, addAddress: async () => Promise.resolve(err("exists")) };
}

async function withCeilingsOver(agents: (store: AgentStore) => AgentStore): Promise<TestEngine> {
  const test = await startTestEngine({ agents });
  test.stores.install.addWallet(wallet);
  test.ceilings.put(wallet.policyId, [owner]);
  return test;
}

describe("saving an address with the owner key", () => {
  it("lists it in the agent's ceilings at once, usable at level 2 a day later", async () => {
    const test = await withCeilings();

    const entry = expectOk(await add(test));

    expect(entry).toStrictEqual({
      entry: entry.entry,
      agent: testAgent,
      address: cold,
      label: "cold",
      usableAt: testNowMs + looseningWaitMs,
      inCeilingAt: testNowMs,
      createdAt: testNowMs,
    });
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner, cold]);
    expect(test.ceilings.recipients(otherWallet.policyId)).toStrictEqual([owner]);
    expect(await sendRefusals(test, cold)).toStrictEqual([]);
    const listed = expectOk(
      await test.engine.handlers["address/list"](testCall({ agent: testAgent })),
    );
    expect(listed.items).toStrictEqual([entry]);
  });

  it("journals the address it saved and pushes the change", async () => {
    const test = await withCeilings();

    const entry = expectOk(await add(test));

    const journal = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(journal).toMatchObject([
      {
        atMs: testNowMs,
        surface: "cli",
        path: `agents.main.addressBook.${entry.entry}`,
        after: { entry: entry.entry, address: cold, label: "cold" },
      },
    ]);
    expect(test.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(1);
  });

  it("keeps the saved addresses and a new rescue address that waits in the ceiling", async () => {
    const test = await withCeilings();
    await saveTestAddress(test);
    await test.stores.install.changeRescue({ address: pending, atMs: testNowMs - 1 }, live);

    expectOk(await add(test));

    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual(
      [owner, pending, testSaved.account, cold].toSorted(),
    );
  });

  it("takes the saved address into a rescue address change that waits", async () => {
    const test = await withCeilings();
    const set = { address: pending, ownerKey: fakeOwnerKeyCode };
    expectOk(await test.engine.handlers["safety/setRescueAddress"](testCall(set)));

    expectOk(await add(test));
    await test.clock.advance(looseningWaitMs);
    await test.engine.settle(live);

    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([pending, cold]);
    expect(test.pushes.filter((push) => push.topic === "notice")).toHaveLength(1);
  });

  it("refuses a wrong owner key, and changes no ceiling and no book", async () => {
    const test = await withCeilings();

    expect(await add(test, { ownerKey: "bnok1aaaaa" })).toStrictEqual(err("wallet.bad_owner_key"));
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
    const listed = expectOk(
      await test.engine.handlers["address/list"](testCall({ agent: testAgent })),
    );
    expect(listed.items).toStrictEqual([]);
  });

  it("answers an address the book holds already, and changes nothing", async () => {
    const test = await withCeilings();
    await saveTestAddress(test);

    const again = expectOk(await add(test, { address: "0x000000f1" }));

    expect(again.entry).toBe(testSaved.id);
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
  });

  it("refuses an address its chain cannot read, and an unknown agent", async () => {
    const test = await withCeilings();

    expect(await add(test, { address: "not-an-address" })).toStrictEqual(err("protocol.bad_args"));
    expect(await add(test, { agent: unknownAgent })).toStrictEqual(err("agent.not_found"));
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
  });

  it("answers the entry another call saved first, and journals nothing", async () => {
    const test = await withCeilingsOver(savedFirst);

    const added = expectOk(await add(test));

    expect(added).toMatchObject({ address: cold, label: "first" });
    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(entries).toStrictEqual([]);
  });

  it("throws when the agent store refuses an address it does not hold", async () => {
    const test = await withCeilingsOver(refusingUnheld);

    await expect(add(test)).rejects.toMatchObject({ code: "engine.address_unsaved" });
  });

  it("refuses an empty address", async () => {
    const test = await withCeilings();

    expect(await add(test, { address: "" })).toStrictEqual(err("protocol.bad_args"));
  });
});
