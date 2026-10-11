import { type AccountRef, accountRefSchema } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { rescueAt } from "../policy/rescue-change.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";

const live = { signal: new AbortController().signal };
const owner: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
const thief: AccountRef = accountRefSchema.parse("fake:1:0x000000b2");
// A console device brakes over WS; it never carries the owner key.
const console: EngineCaller = {
  credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "console", version: "test" },
  scopes: ["read", "confirm", "admin"],
  transport: "ws",
};
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 2 * looseningWaitMs,
});
const archived = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c2"),
  agentId: testAgent,
  label: "old",
  createdAtMs: testNowMs - 3 * looseningWaitMs,
  archivedAtMs: testNowMs - 2 * looseningWaitMs,
});

function setRescue(
  test: TestEngine,
  address: AccountRef,
  call: { readonly ownerKey?: string; readonly caller?: EngineCaller } = {},
) {
  const { ownerKey = fakeOwnerKeyCode, caller = testCallers.cli } = call;
  return test.engine.handlers["safety/setRescueAddress"](testCall({ address, ownerKey }, caller));
}

function cancelChange(test: TestEngine) {
  return test.engine.handlers["safety/cancelRescueChange"](testCall({}, console));
}

// The test engine with the owner's rescue address in effect since a day before the test, and one
// live wallet whose ceiling lists it.
async function withRescue(): Promise<TestEngine> {
  const test = await startTestEngine();
  await test.stores.install.changeRescue(
    { address: owner, atMs: testNowMs - 2 * looseningWaitMs },
    live,
  );
  test.stores.install.addWallet(archived);
  test.stores.install.addWallet(wallet);
  test.ceilings.put(wallet.policyId, [owner]);
  test.ceilings.put(archived.policyId, [owner]);
  return test;
}

async function rescueNow(test: TestEngine) {
  return rescueAt(await test.stores.install.read(live), test.clock.now());
}

function noticeData(test: TestEngine): readonly unknown[] {
  return test.pushes.filter((push) => push.topic === "notice").map((push) => push.data);
}

describe("a change of the rescue address", () => {
  it("pays the new address only 24 hours later, announced with that time", async () => {
    const test = await withRescue();
    const effectiveAt = testNowMs + looseningWaitMs;

    expect(await setRescue(test, thief)).toStrictEqual({ ok: true, value: { effectiveAt } });
    await test.clock.advance(looseningWaitMs - 1);
    expect((await rescueNow(test)).rescueAddress).toBe(owner);
    await test.clock.advance(1);
    expect((await rescueNow(test)).rescueAddress).toBe(thief);
    expect(noticeData(test)).toStrictEqual([
      {
        key: "notice.rescueAddress",
        values: { address: "0x000000b2" },
        times: { when: effectiveAt },
      },
    ]);
  });

  it("saves the new address in every live wallet's ceiling at once, beside the old one", async () => {
    const test = await withRescue();
    await saveTestAddress(test);

    expectOk(await setRescue(test, thief));

    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual(
      [owner, thief, testSaved.account].toSorted(),
    );
    expect(test.ceilings.recipients(archived.policyId)).toStrictEqual([owner]);
  });

  it("leaves the old address out of the ceilings once the new one takes effect", async () => {
    const test = await withRescue();
    expectOk(await setRescue(test, thief));

    await test.clock.advance(looseningWaitMs - 1);
    await test.engine.settle(live);
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner, thief]);
    await test.clock.advance(1);
    await test.engine.settle(live);

    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([thief]);
    expect((await test.stores.install.read(live)).rescueCeiling).toBeUndefined();
  });

  it("tells the owner when a ceiling changed meanwhile and the old address stays in it", async () => {
    const test = await withRescue();
    expectOk(await setRescue(test, thief));
    test.ceilings.put(wallet.policyId, [owner, thief, testSaved.account]);

    await test.clock.advance(looseningWaitMs);
    await test.engine.settle(live);

    expect(test.ceilings.recipients(wallet.policyId)).toHaveLength(3);
    expect(noticeData(test).at(-1)).toStrictEqual({
      key: "notice.ceilingOutdated",
      values: { address: "0x000000a1" },
    });
  });

  it("refuses a wrong or missing owner key and a call over WS, and changes nothing", async () => {
    const test = await withRescue();
    const admin = { ...console, transport: "ws" as const };

    expect([
      await setRescue(test, thief, { ownerKey: "bnok1aaaaa bbbbb ccccc ddddd eeeee" }),
      await test.engine.handlers["safety/setRescueAddress"](testCall({ address: thief })),
      await setRescue(test, thief, { caller: admin }),
    ]).toStrictEqual([
      err("wallet.bad_owner_key"),
      err("wallet.bad_owner_key"),
      err("auth.local_only"),
    ]);
    expect(await rescueNow(test)).toStrictEqual({ rescueAddress: owner });
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
    expect(test.pushes).toStrictEqual([]);
  });

  it("is cancelled from any surface that brakes, and the owner's address stays", async () => {
    const test = await withRescue();
    await setRescue(test, thief);

    expect(await cancelChange(test)).toStrictEqual({ ok: true, value: {} });
    expect(noticeData(test).at(-1)).toStrictEqual({
      key: "notice.rescueAddressCancelled",
      values: { address: "0x000000b2" },
    });
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
    await test.clock.advance(looseningWaitMs);
    await test.engine.settle(live);
    expect(await rescueNow(test)).toStrictEqual({ rescueAddress: owner });
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
  });

  it("is journaled and pushed as a config change, both ways", async () => {
    const test = await withRescue();
    await setRescue(test, thief);
    await cancelChange(test);

    const entries = await test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    const pendingRescue = { address: thief, atMs: testNowMs + looseningWaitMs };
    expect(
      entries.map(({ path, surface, before, after }) => ({ path, surface, before, after })),
    ).toStrictEqual([
      {
        path: "safety.rescueAddress",
        surface: "cli",
        before: { rescueAddress: owner },
        after: { rescueAddress: owner, pendingRescue },
      },
      {
        path: "safety.rescueAddress",
        surface: "console",
        before: { rescueAddress: owner, pendingRescue },
        after: { rescueAddress: owner },
      },
    ]);
    expect(test.pushes.filter((push) => push.kind === "config/changed")).toHaveLength(2);
  });

  it("keeps its time when asked again, and answers now for the address in effect", async () => {
    const test = await withRescue();
    await setRescue(test, thief);
    await test.clock.advance(60_000);

    expect(await setRescue(test, thief)).toStrictEqual({
      ok: true,
      value: { effectiveAt: testNowMs + looseningWaitMs },
    });
    expect(await setRescue(test, owner)).toStrictEqual({
      ok: true,
      value: { effectiveAt: testNowMs + 60_000 },
    });
    expect(await rescueNow(test)).toStrictEqual({ rescueAddress: owner });
    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([owner]);
    expect(noticeData(test)).toStrictEqual([
      {
        key: "notice.rescueAddress",
        values: { address: "0x000000b2" },
        times: { when: testNowMs + looseningWaitMs },
      },
      { key: "notice.rescueAddressCancelled", values: { address: "0x000000b2" } },
    ]);
  });

  it("stores the address in its family's canonical form", async () => {
    const test = await withRescue();
    await setRescue(test, accountRefSchema.parse("fake:1:0x000000B2"));

    expect((await rescueNow(test)).pendingRescue?.address).toBe(thief);
  });

  it("refuses an address on an unknown chain or one its family cannot read", async () => {
    const test = await withRescue();

    expect(await setRescue(test, accountRefSchema.parse("fake:9:0x000000b2"))).toStrictEqual(
      err("protocol.bad_args"),
    );
    expect(await setRescue(test, accountRefSchema.parse("fake:1:nowhere"))).toStrictEqual(
      err("protocol.bad_args"),
    );
    expect(test.pushes).toStrictEqual([]);
  });

  it("changes nothing when nothing waits to be cancelled", async () => {
    const test = await withRescue();

    expect(await cancelChange(test)).toStrictEqual({ ok: true, value: {} });
    expect(test.pushes).toStrictEqual([]);
  });

  it("tells the owner when a cancelled address stays in a ceiling that changed meanwhile", async () => {
    const test = await withRescue();
    expectOk(await setRescue(test, thief));
    test.ceilings.put(wallet.policyId, [owner, thief, testSaved.account]);

    expect(await cancelChange(test)).toStrictEqual({ ok: true, value: {} });

    expect(test.ceilings.recipients(wallet.policyId)).toContain(thief);
    expect(noticeData(test).at(-1)).toStrictEqual({
      key: "notice.ceilingOutdated",
      values: { address: "0x000000b2" },
    });
  });

  it("signs no change ahead for a cancel when no address was in effect before", async () => {
    const test = await startTestEngine();
    test.stores.install.addWallet(wallet);
    test.ceilings.put(wallet.policyId, [owner]);

    expectOk(await setRescue(test, thief));

    expect(test.ceilings.recipients(wallet.policyId)).toStrictEqual([thief]);
    const facts = await test.stores.install.read(live);
    expect(facts.rescueCeiling?.onEffect).toBeDefined();
    expect(facts.rescueCeiling?.onCancel).toBeUndefined();
    expect(await cancelChange(test)).toStrictEqual({ ok: true, value: {} });
    expect(await rescueNow(test)).toStrictEqual({});
  });
});
