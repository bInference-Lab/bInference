import { type AccountRef, accountRefSchema } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import type { WalletRecord } from "../install/install-record.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

const live = { signal: new AbortController().signal };
const owner: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
const next: AccountRef = accountRefSchema.parse("fake:1:0x000000a2");
const unknownAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const main = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 3 * looseningWaitMs,
});
// An address added without the owner key: no ceiling lists it, so no new one does either.
const unsaved: AddressEntryRecord = {
  id: idSchema("adr").parse("adr_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
  agentId: testAgent,
  account: accountRefSchema.parse("fake:1:0x000000f2"),
  label: "exchange",
  usableAtMs: testNowMs,
  createdAtMs: testNowMs - looseningWaitMs,
};

function create(
  test: TestEngine,
  args: { readonly ownerKey?: string; readonly agent?: string; readonly launch?: true } = {},
) {
  const { ownerKey = fakeOwnerKeyCode, agent = testAgent, launch } = args;
  const call = { agent: idSchema("agt").parse(agent), label: "spare", ownerKey };
  return test.engine.handlers["wallet/create"](
    testCall(launch === undefined ? call : { ...call, launch }),
  );
}

// The test engine with the owner's rescue address in effect and one live wallet listing it.
async function withRescue(): Promise<TestEngine> {
  const test = await startTestEngine({
    custodyWallets: new Map([[main.id, accountRefSchema.parse("fake:1:0x000000c1")]]),
  });
  await test.stores.install.changeRescue(
    { address: owner, atMs: testNowMs - 3 * looseningWaitMs },
    live,
  );
  test.stores.install.addWallet(main);
  test.ceilings.put(main.policyId, [owner]);
  return test;
}

async function labels(test: TestEngine): Promise<readonly string[]> {
  const { wallets } = await test.stores.install.read(live);
  return wallets.map((wallet) => wallet.label);
}

// The wallet `wallet/create` made, as the install store keeps it.
async function newWallet(test: TestEngine): Promise<WalletRecord> {
  const { wallets } = await test.stores.install.read(live);
  const made = wallets.find((wallet) => wallet.label === "spare");
  if (made === undefined) {
    throw new Error("Expected the new wallet.");
  }
  return made;
}

describe("making a wallet with the owner key", () => {
  it("lists only the rescue address and the saved addresses in its ceiling", async () => {
    const test = await withRescue();
    await saveTestAddress(test);
    await saveTestAddress(test, unsaved);

    const view = expectOk(await create(test));

    const stored = await newWallet(test);
    expect(view).toStrictEqual({
      wallet: stored.id,
      agent: testAgent,
      address: accountRefSchema.parse(`fake:1:${stored.address}`),
      label: "spare",
      createdAt: testNowMs,
    });
    expect(test.walletMaker.recipients(stored.policyId)).toStrictEqual(
      [owner, testSaved.account].toSorted(),
    );
    const listed = expectOk(
      await test.engine.handlers["wallet/list"](testCall({ agent: testAgent })),
    );
    expect(listed.items.map((item) => item.label)).toStrictEqual(["main", "spare"]);
  });

  it("journals the wallet it made and pushes the change", async () => {
    const test = await withRescue();

    const view = expectOk(await create(test));

    const journal = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(journal).toMatchObject([
      {
        atMs: testNowMs,
        surface: "cli",
        path: `agents.main.wallets.${view.wallet}`,
        after: { wallet: view.wallet, label: "spare" },
      },
    ]);
    expect(test.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(1);
  });

  it("makes nothing for a wrong owner key, an unknown agent or no rescue address", async () => {
    const test = await withRescue();
    const bare = await startTestEngine();

    expect(await create(test, { ownerKey: "bnok1aaaaa" })).toStrictEqual(
      err("wallet.bad_owner_key"),
    );
    expect(await create(test, { agent: unknownAgent })).toStrictEqual(err("agent.not_found"));
    expect(await create(bare)).toStrictEqual(err("rescue.no_address"));
    expect([test.walletMaker.count(), bare.walletMaker.count()]).toStrictEqual([0, 0]);
    expect(await labels(test)).toStrictEqual(["main"]);
  });

  it("makes the agent's launch wallet with its role, and refuses a second", async () => {
    const test = await withRescue();

    const view = expectOk(await create(test, { launch: true }));

    const stored = await newWallet(test);
    expect([view.role, stored.role]).toStrictEqual(["launch", "launch"]);
    expect(JSON.stringify(stored.ceiling.policy)).toContain('"isLaunch":true');
    expect(await create(test, { launch: true })).toStrictEqual(err("wallet.launch_exists"));
    expect(test.walletMaker.count()).toBe(1);
    const listed = expectOk(await test.engine.handlers["agent/list"](testCall({})));
    expect(
      listed.items.map((agent) => [agent.defaultWallet?.label, agent.launchWallet?.label]),
    ).toStrictEqual([["main", "spare"]]);
  });

  it("takes the new wallet into a rescue address change that waits", async () => {
    const test = await withRescue();
    const set = { address: next, ownerKey: fakeOwnerKeyCode };
    expectOk(await test.engine.handlers["safety/setRescueAddress"](testCall(set)));

    expectOk(await create(test));
    const policy = (await newWallet(test)).policyId;
    expect(test.ceilings.recipients(policy)).toStrictEqual([owner, next]);
    await test.clock.advance(looseningWaitMs);
    await test.engine.settle(live);

    expect(test.ceilings.recipients(policy)).toStrictEqual([next]);
    expect(test.ceilings.recipients(main.policyId)).toStrictEqual([next]);
  });
});
