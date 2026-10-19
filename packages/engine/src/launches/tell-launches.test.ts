import { accountRefSchema, assetRefSchema, chainRefSchema, isTxHash } from "@binference/chain";
import { createFakeLaunchpad, createFakeVenue } from "@binference/chain/testing";
import type { AlertFired, LaunchView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { WatchedLaunch } from "../alerts/fire-alerts.js";
import { expectOk, testAgent, testCoin } from "../intents/test-intents.js";
import { startTestEngine, testCall, testChains } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { StoredLaunch } from "./launch-record.js";
import { tellLaunches } from "./tell-launches.js";

const chain = chainRefSchema.parse("fake:1");
const creator = accountRefSchema.parse("fake:1:0x000000c1");
const tx = `0x${"ab".repeat(32)}`;

// A stored launch `n`, its block `n`, made by the creator with no earlier launch.
function storedLaunch(n: number): StoredLaunch {
  if (!isTxHash(tx)) {
    throw new Error("Not a hash.");
  }
  return {
    chain,
    token: assetRefSchema.parse(`fake:1/token:0x0000c0${String(n).padStart(2, "0")}`),
    launchpad: "fake-curve",
    creator,
    quoteToken: testCoin,
    graduated: false,
    insiders: [],
    block: BigInt(n),
    blockHash: "0x01",
    txHash: tx,
    logIndex: n,
    launchedAtMs: 1_800_000_000_000 + n,
    changedAtMs: 1_800_000_000_000 + n,
    creatorLaunches30d: 0,
  };
}

const live = { signal: new AbortController().signal };

// Launch alerts that fail on the first launch they see and fire none on the others.
function failingFirst(seen: { readonly push: (launch: WatchedLaunch) => number }) {
  return {
    seeLaunch: async (launch: WatchedLaunch): Promise<readonly AlertFired[]> =>
      seen.push(launch) === 1 ? Promise.reject(new Error("store down")) : Promise.resolve([]),
  };
}

describe("tellLaunches", () => {
  it("pushes each launch as launch/new and fires the launch alerts it passes, in order", async () => {
    const test = await startTestEngine({
      chains: testChains(["fake-curve"]),
      venues: [createFakeVenue(), createFakeLaunchpad({ onCurve: [] })],
    });
    const condition = { kind: "launch", filters: { launchpads: ["fake-curve"] } } as const;
    expectOk(await test.engine.handlers["alert/create"](testCall({ agent: testAgent, condition })));
    const pushes: EnginePush[] = [];
    const parts = {
      chains: test.engineOptions.chains,
      publish: (push: EnginePush) => pushes.push(push),
      alerts: test.engine.alerts,
    };
    await tellLaunches(parts, [storedLaunch(1), storedLaunch(2)], live);
    const told = pushes.map(({ topic, kind, data }) => [
      topic,
      kind,
      (data as unknown as LaunchView).block,
    ]);
    expect(told).toStrictEqual([
      ["launch", "launch/new", 1],
      ["launch", "launch/new", 2],
    ]);
    const fired = test.pushes.filter(({ kind }) => kind === "alert/fired");
    expect(fired.map(({ data }) => (data as unknown as AlertFired).fired.kind)).toStrictEqual([
      "launch",
      "launch",
    ]);
  });

  it("reports a launch whose alerts failed and tells the next one", async () => {
    const pushes: EnginePush[] = [];
    const failed: StoredLaunch[] = [];
    const seen: WatchedLaunch[] = [];
    const alerts = failingFirst(seen);
    const parts = {
      chains: testChains(),
      publish: (push: EnginePush) => pushes.push(push),
      alerts,
      onAlertFailed: (launch: StoredLaunch) => failed.push(launch),
    };
    await tellLaunches(parts, [storedLaunch(1), storedLaunch(2)], live);
    expect(pushes).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(failed.map(({ block }) => block)).toStrictEqual([1n]);
    const reason = new Error("stopped");
    await expect(
      tellLaunches(parts, [storedLaunch(3)], { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });
});
