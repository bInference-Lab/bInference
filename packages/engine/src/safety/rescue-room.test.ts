import { err } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import {
  bridgeEngine,
  bridgeFakes,
  testFarEntry,
  testRescue,
  testRescueThere,
  testSpoke,
} from "../bridges/test-bridges.js";
import { createFakeCeilingEditor } from "../fakes/fake-ceiling-editor.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import {
  nextRescue,
  nextRescueThere,
  noticesNamed,
  saveFor,
  setTestRescue,
  testPolicyOf,
} from "./test-rescue-bridged.js";

const live = { signal: new AbortController().signal };

describe("the rescue address where a destination's list is full", () => {
  it("keeps a standing left out for room as room, never as paid", async () => {
    const held = createFakeCeilingEditor({
      clock: createManualClock(testNowMs),
      chains: bridgeFakes().chains,
    });
    const ceilings = { ...held, mostPerChain: 2 };
    const bench = await bridgeEngine({ bridged: [testFarEntry.account], ceilings });
    const policy = await testPolicyOf(bench);
    held.put(policy, [testRescue], { contracts: [testSpoke], perTxNativeBase: 1n });

    expectOk(await setTestRescue(bench, nextRescue));
    const { rescueReach } = await bench.test.stores.install.read(live);
    expect(rescueReach).toStrictEqual([
      { agent: testAgent, account: testRescueThere, state: "joined" },
      { agent: testAgent, account: nextRescueThere, state: "room" },
    ]);
    expect(held.bridged(policy)).toStrictEqual([testFarEntry.account, testRescueThere]);
    expect(noticesNamed(bench, "notice.rescueNotBridged")).toStrictEqual([
      { agent: "main", address: "0x000000d8", chains: "Fake Two", why: "room" },
    ]);
  });

  it("keeps no standing custody holds nowhere once it refused the whole write", async () => {
    const held = createFakeCeilingEditor({
      clock: createManualClock(testNowMs),
      chains: bridgeFakes().chains,
    });
    const refusing = { ...held, setCalls: async () => Promise.resolve(err("too_large" as const)) };
    const bench = await bridgeEngine({ bridged: [testFarEntry.account], ceilings: refusing });
    const policy = await testPolicyOf(bench);
    held.put(policy, [testRescue], { contracts: [testSpoke], perTxNativeBase: 1n });

    expect(await saveFor(bench, { address: "0x000000c5" })).toStrictEqual(
      err("wallet.ceiling_too_large"),
    );
    expect(held.bridged(policy)).toStrictEqual([]);
    expect((await bench.test.stores.install.read(live)).rescueReach).toBeUndefined();
    expect(noticesNamed(bench, "notice.rescueBridged")).toStrictEqual([]);
  });
});
