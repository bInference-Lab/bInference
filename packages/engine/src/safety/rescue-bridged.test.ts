import { accountRefSchema } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  bridgeEngine,
  bridgeFakes,
  testDestination,
  testDestinationChain,
  testFarEntry,
  testHexCodec,
  testRescue,
  testRescueThere,
  testSpoke,
} from "../bridges/test-bridges.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { rescuesOn } from "./rescue-reach.js";
import {
  addAltAgent,
  altAgent,
  holdTestCeiling,
  nextRescue,
  nextRescueThere,
  noticesNamed,
  partWayCustody,
  saveFor,
  setTestCap,
  setTestRescue,
  testPolicyOf,
} from "./test-rescue-bridged.js";

const live = { signal: new AbortController().signal };

describe("the rescue address in the bridge rules", () => {
  it.each([
    ["of another family", testHexCodec("wide", 4)],
    ["whose codec cannot read the address", testHexCodec("fake", 8)],
  ])("tells a destination %s as one the rescue address cannot be paid on", async (_, codec) => {
    const fakes = bridgeFakes();
    const other = { ...testDestinationChain(fakes.codesThere), codec };
    const bench = await bridgeEngine({ bridged: [testFarEntry.account], destinations: [other] });
    const policy = await holdTestCeiling(bench);

    expectOk(await setTestRescue(bench, nextRescue));
    expect(bench.test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account]);
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", why: "kind" },
      { agent: "main", address: "0x000000d8", chains: "Fake Two", why: "kind" },
    ]);
  });

  it("keeps the old rescue address on the destination until its change takes effect", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const { test } = bench;
    const policy = await holdTestCeiling(bench);

    expectOk(await setTestRescue(bench, nextRescue));
    expect(test.ceilings.bridged(policy)).toStrictEqual([
      testFarEntry.account,
      nextRescueThere,
      testRescueThere,
    ]);
    await test.clock.advance(looseningWaitMs - 1);
    await test.engine.settle(live);
    expect(test.ceilings.bridged(policy)).toContain(testRescueThere);
    await test.clock.advance(1);
    await test.engine.settle(live);
    expect(test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account, nextRescueThere]);
    expect(test.ceilings.recipients(policy)).toStrictEqual([nextRescue]);
  });

  it("says a waiting address pays from its time, then tells once that it does", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    await holdTestCeiling(bench);

    expectOk(await setTestRescue(bench, nextRescue));
    const atSet = noticesNamed(bench, "notice.rescueBridged");
    await bench.test.clock.advance(looseningWaitMs);
    await bench.test.engine.settle(live);
    await bench.test.engine.settle(live);

    expect(atSet).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", status: "now" },
      { agent: "main", address: "0x000000d8", chains: "Fake Two", status: "waiting" },
    ]);
    expect(noticesNamed(bench, "notice.rescueBridged").slice(atSet.length)).toStrictEqual([
      { agent: "main", address: "0x000000d8", chains: "Fake Two", status: "now" },
    ]);
    const { rescueReach } = await bench.test.stores.install.read(live);
    expect(rescueReach).toStrictEqual([
      { agent: testAgent, account: nextRescueThere, state: "joined" },
    ]);
  });

  it("tells a standing once, whatever later writes of other kinds do", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    await holdTestCeiling(bench);
    bench.codesThere.place(nextRescueThere, "delegation");

    expectOk(await setTestRescue(bench, nextRescue));
    expectOk(await saveFor(bench, { address: "0x000000c5" }));
    expectOk(await setTestCap(bench, 2n));
    expectOk(await saveFor(bench, { address: "0x000000a7", chain: "fake:1" }));

    expect(noticesNamed(bench, "notice.rescueBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", status: "now" },
    ]);
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d8", chains: "Fake Two", why: "code" },
    ]);
  });

  it("keeps no standing and tells nothing when custody refuses the owner key", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    await holdTestCeiling(bench);
    bench.codesThere.place(nextRescueThere, "contract");

    expect(
      await setTestRescue(bench, nextRescue, "bnok1aaaaa bbbbb ccccc ddddd eeeee"),
    ).toStrictEqual(err("wallet.bad_owner_key"));
    expect((await bench.test.stores.install.read(live)).rescueReach).toBeUndefined();
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([]);
  });

  it("leaves a rescue address out where it holds code, and names the chain", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const policy = await holdTestCeiling(bench);
    bench.codesHere.place(testRescue, "contract");

    expectOk(await setTestRescue(bench, nextRescue));
    expect(bench.test.ceilings.bridged(policy)).toStrictEqual([
      testFarEntry.account,
      nextRescueThere,
    ]);
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", why: "code" },
    ]);
  });

  it("leaves it out of a chain it cannot read, and reads again at the next change", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const policy = await holdTestCeiling(bench);
    bench.codesThere.down();

    expectOk(await setTestRescue(bench, nextRescue));
    expect(bench.test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account]);
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", why: "unread" },
      { agent: "main", address: "0x000000d8", chains: "Fake Two", why: "unread" },
    ]);
    bench.codesThere.up();
    expectOk(await saveFor(bench, { address: "0x000000c5" }));
    expect(bench.test.ceilings.bridged(policy)).toContain(testRescueThere);
    expect(bench.test.ceilings.bridged(policy)).toContain(nextRescueThere);
  });

  it("tells a destination with no code reader as one it cannot read", async () => {
    const { codes: _codes, ...unread } = testDestinationChain(bridgeFakes().codesThere);
    const bench = await bridgeEngine({ bridged: [testFarEntry.account], destinations: [unread] });
    const policy = await holdTestCeiling(bench);

    expectOk(await setTestRescue(bench, nextRescue));
    expect(bench.test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account]);
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", why: "unread" },
      { agent: "main", address: "0x000000d8", chains: "Fake Two", why: "unread" },
    ]);
  });

  it("checks, lists and tells each agent only in that agent's own write", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const main = await holdTestCeiling(bench);
    const alt = await addAltAgent(bench);
    bench.codesThere.down();
    expectOk(await setTestRescue(bench, nextRescue));
    bench.codesThere.up();
    const told = () => noticesNamed(bench, "notice.rescueBridged");

    expectOk(await saveFor(bench, { address: "0x000000c5", agent: altAgent }));
    expectOk(await saveFor(bench, { address: "0x000000a7", chain: "fake:1" }));
    expect(bench.test.ceilings.bridged(alt)).toContain(testRescueThere);
    expect(bench.test.ceilings.bridged(main)).not.toContain(testRescueThere);
    expect(told()).toStrictEqual([
      { agent: "alt", address: "0x000000d9", chains: "Fake Two", status: "now" },
      { agent: "alt", address: "0x000000d8", chains: "Fake Two", status: "waiting" },
    ]);
    expectOk(await saveFor(bench, { address: "0x000000c6" }));
    expect(bench.test.ceilings.bridged(main)).toContain(testRescueThere);
    expect(told().slice(2)).toStrictEqual([
      { agent: "main", address: "0x000000d9", chains: "Fake Two", status: "now" },
      { agent: "main", address: "0x000000d8", chains: "Fake Two", status: "waiting" },
    ]);
  });

  it("keeps the new address in the rule when ceiling set lists it while its change waits", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const policy = await holdTestCeiling(bench);
    expectOk(await saveFor(bench, { address: "0x000000c5" }));
    bench.codesThere.down();
    expectOk(await setTestRescue(bench, nextRescue));
    bench.codesThere.up();

    expectOk(await setTestCap(bench, 2n));
    expect(bench.test.ceilings.bridged(policy)).toContain(nextRescueThere);
    await bench.test.clock.advance(looseningWaitMs);
    await bench.test.engine.settle(live);

    expect(bench.test.ceilings.bridged(policy)).toContain(nextRescueThere);
    expect(bench.test.ceilings.bridged(policy)).not.toContain(testRescueThere);
    expect(noticesNamed(bench, "notice.ceilingOutdated")).toStrictEqual([]);
  });

  it("believes what custody holds after a write it refused part way, and journals it", async () => {
    const { held, partWay } = partWayCustody();
    const bench = await bridgeEngine({ bridged: [testFarEntry.account], ceilings: partWay });
    const first = await testPolicyOf(bench);
    const second = testWalletRecord({
      id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c7"),
      agentId: testAgent,
      label: "second",
      createdAtMs: testNowMs,
    });
    bench.test.stores.install.addWallet(second);
    const calls = { contracts: [testSpoke], perTxNativeBase: 1n };
    held.put(first, [testRescue], calls);
    held.put(second.policyId, [testRescue], calls);

    expect(await saveFor(bench, { address: "0x000000c5" })).toStrictEqual(
      err("wallet.ceiling_too_large"),
    );
    expect(held.bridged(first)).toContain(testRescueThere);
    expect(held.bridged(second.policyId)).not.toContain(testRescueThere);
    expect((await bench.test.stores.install.read(live)).rescueReach).toStrictEqual([
      { agent: testAgent, account: testRescueThere, state: "joined" },
    ]);
    expect(noticesNamed(bench, "notice.rescueBridged")).toHaveLength(1);
    const journal = await bench.test.stores.configJournal.list({ after: 0, limit: 10 }, live);
    expect(journal.map((entry) => entry.path)).toContain("agents.main.ceiling");
  });

  it("gives a rebuilt install the same rule once the owner saves the destination again", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const { test } = bench;
    const lost = await holdTestCeiling(bench);
    const second = expectOk(await saveFor(bench, { address: "0x000000c5" }));
    const before = test.ceilings.bridged(lost);
    expect(before).toStrictEqual([testFarEntry.account, "fake:2:0x000000c5", testRescueThere]);
    const rebuilt = testWalletRecord({
      id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c8"),
      agentId: testAgent,
      label: "rebuilt",
      createdAtMs: testNowMs,
    });
    const custody = {
      provider: "privy" as const,
      appId: "app",
      ownerQuorumId: "owner",
      ownerKeyPublic: "b3duZXIga2V5",
      agentQuorumId: "agent",
      agentKeyPublic: "YWdlbnQga2V5",
      attachedAtMs: testNowMs,
    };
    const setUp = {
      atMs: testNowMs,
      custody,
      rescueAddress: testRescue,
      wallet: rebuilt,
      isStartOver: true,
    };
    expectOk(await test.stores.install.setUp(setUp, live));
    test.ceilings.put(rebuilt.policyId, [testRescue], {
      contracts: [testSpoke],
      perTxNativeBase: 1n,
    });
    // A rebuild starts with no saved address, as with no standing.
    for (const entry of [testFarEntry.id, second.entry]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one removal at a time
      expectOk(await test.engine.handlers["address/remove"](testCall({ entry })));
    }
    expect((await test.stores.install.read(live)).rescueReach).toBeUndefined();

    expectOk(await saveFor(bench, { address: "0x000000b1" }));
    expectOk(await saveFor(bench, { address: "0x000000c5" }));
    expect(test.ceilings.bridged(rebuilt.policyId)).toStrictEqual(before);
  });

  it("counts the rescue address in a destination's room as its agent's standing lists it", async () => {
    const { test } = await bridgeEngine();
    const room = async () => {
      const listed = await test.engine.handlers["address/list"](testCall({ agent: testAgent }));
      return expectOk(listed).room;
    };

    expect(await room()).toStrictEqual([{ chain: "fake:2", used: 1, most: 100 }]);
    const joined = { agent: testAgent, account: testRescueThere, state: "joined" as const };
    const kept = { agents: [testAgent], records: [joined], atMs: testNowMs };
    await test.stores.install.keepRescueReach(kept, live);
    expect(await room()).toStrictEqual([{ chain: "fake:2", used: 2, most: 100 }]);
    const facts = await test.stores.install.read(live);
    const at = { agent: altAgent, chain: testDestination, nowMs: testNowMs };
    expect(rescuesOn(facts, at)).toStrictEqual([]);
  });

  it("counts a standing only for the rescue address in effect or the one that waits", async () => {
    const { test } = await bridgeEngine();
    const old = accountRefSchema.parse("fake:2:0x000000d7");
    const records = [
      { agent: testAgent, account: testRescueThere, state: "joined" as const },
      { agent: testAgent, account: old, state: "joined" as const },
    ];
    await test.stores.install.keepRescueReach(
      { agents: [testAgent], records, atMs: testNowMs },
      live,
    );
    const facts = await test.stores.install.read(live);

    expect(facts.rescueReach?.map((record) => record.account)).toStrictEqual([testRescueThere]);
    const at = { agent: testAgent, chain: testDestination, nowMs: testNowMs };
    expect(rescuesOn(facts, at)).toStrictEqual([testRescueThere]);
  });
});
