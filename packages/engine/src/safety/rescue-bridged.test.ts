import { accountRefSchema, type AccountRef } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  bridgeEngine,
  testDestination,
  testFarEntry,
  testRescueThere,
} from "../bridges/test-bridges.js";
import type { RescueReachRecord, RescueReachState } from "../install/rescue-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { rescuesOn } from "./rescue-reach.js";
import { holdTestCeiling, nextRescue, setTestRescue } from "./test-rescue-bridged.js";

const live = { signal: new AbortController().signal };
const otherAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-00000000000a");

function standing(
  account: AccountRef,
  state: RescueReachState,
  agent = testAgent,
): RescueReachRecord {
  return { agent, account, state };
}

describe("the rescue address in the bridge rules", () => {
  it("keeps the old rescue address on the destination until its change takes effect", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const { test } = bench;
    const policy = await holdTestCeiling(bench);
    const records = [standing(testRescueThere, "joined")];
    await test.stores.install.keepRescueReach({ agents: [testAgent], records, atMs: testNowMs }, live);

    expectOk(await setTestRescue(bench, nextRescue));
    expect(test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account, testRescueThere]);
    await test.clock.advance(looseningWaitMs - 1);
    await test.engine.settle(live);
    expect(test.ceilings.bridged(policy)).toContain(testRescueThere);
    await test.clock.advance(1);
    await test.engine.settle(live);
    expect(test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account]);
    expect(test.ceilings.recipients(policy)).toStrictEqual([nextRescue]);
  });

  it("lists nothing on the destination from another agent's standing", async () => {
    const bench = await bridgeEngine({ bridged: [testFarEntry.account] });
    const { test } = bench;
    const policy = await holdTestCeiling(bench);
    const records = [standing(testRescueThere, "joined", otherAgent)];
    await test.stores.install.keepRescueReach(
      { agents: [otherAgent], records, atMs: testNowMs },
      live,
    );

    expectOk(await setTestRescue(bench, nextRescue));
    expect(test.ceilings.bridged(policy)).toStrictEqual([testFarEntry.account]);
  });

  it("counts the rescue address in a destination's room as its agent's standing lists it", async () => {
    const { test } = await bridgeEngine();
    const room = async () => {
      const listed = await test.engine.handlers["address/list"](testCall({ agent: testAgent }));
      return expectOk(listed).room;
    };

    expect(await room()).toStrictEqual([{ chain: "fake:2", used: 1, most: 100 }]);
    const records = [standing(testRescueThere, "joined")];
    await test.stores.install.keepRescueReach({ agents: [testAgent], records, atMs: testNowMs }, live);
    expect(await room()).toStrictEqual([{ chain: "fake:2", used: 2, most: 100 }]);
    const facts = await test.stores.install.read(live);
    const at = { agent: otherAgent, chain: testDestination, nowMs: testNowMs };
    expect(rescuesOn(facts, at)).toStrictEqual([]);
  });

  it("counts a standing only for the rescue address in effect or the one that waits", async () => {
    const { test } = await bridgeEngine();
    const old = accountRefSchema.parse("fake:2:0x000000d7");
    const records = [standing(testRescueThere, "joined"), standing(old, "joined")];
    await test.stores.install.keepRescueReach({ agents: [testAgent], records, atMs: testNowMs }, live);
    const facts = await test.stores.install.read(live);

    expect(facts.rescueReach?.map((record) => record.account)).toStrictEqual([testRescueThere]);
    const at = { agent: testAgent, chain: testDestination, nowMs: testNowMs };
    expect(rescuesOn(facts, at)).toStrictEqual([testRescueThere]);
  });
});
