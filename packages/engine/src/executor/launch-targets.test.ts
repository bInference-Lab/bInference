import { accountRefSchema, assetRefSchema, type Venue } from "@binference/chain";
import { createFakeLaunchpad, createFakeVenue } from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testLimits,
  testNowMs,
  testWallet,
} from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testChains,
} from "../operations/test-engine.js";
import { createVenueHost } from "../venues/venue-host.js";
import { launchTargetsOf } from "./launch-targets.js";

const live = { signal: new AbortController().signal };
const launchCurve = accountRefSchema.parse("fake:1:0x000000c1");
const token = assetRefSchema.parse("fake:1/token:0x0000000f");
const launchWallet = fixtureId("wal", 218);
const venues = [createFakeVenue(), createFakeLaunchpad({ onCurve: [token], launchCurve })];
// The same launchpad once the token graduated: it holds nothing on its curve.
const graduated = [createFakeVenue(), createFakeLaunchpad({ onCurve: [], launchCurve })];

// A live agent with its launch wallet, whose launchpad holds the token on a curve of its own.
async function engine(): Promise<TestEngine> {
  const test = await startTestEngine({
    chains: testChains(["fake-curve"]),
    venues,
    agent: { mode: "live", limits: { ...testLimits, venues: ["fake-swap", "fake-curve"] } },
    wallets: [testWallet, launchWallet],
    custodyWallets: new Map([[launchWallet, accountRefSchema.parse("fake:1:0x000000d8")]]),
  });
  test.stores.install.addWallet(
    testWalletRecord({
      id: launchWallet,
      agentId: testAgent,
      label: "curves",
      createdAtMs: testNowMs,
      role: "launch",
    }),
  );
  return test;
}

// The launch targets of a buy of the token, from the wallet given or the one it routes to, read
// with the launchpads' curve reads unless they are left out.
async function targetsOf(
  test: TestEngine,
  options: {
    readonly wallet?: Id<"wal">;
    readonly withoutCurves?: true;
    readonly readWith?: readonly Venue[];
  } = {},
) {
  const { wallet, withoutCurves, readWith = venues } = options;
  const buy = {
    kind: "buy",
    agent: testAgent,
    reason: "Buy the launch",
    token,
    spend: { asset: testCoin, base: 1_000_000n },
  } as const;
  const request = wallet === undefined ? buy : { ...buy, wallet };
  const view = expectOk(await test.engine.handlers["intent/propose"](testCall(request)));
  const ids = createIdSource({ clock: test.clock, random: createSeededRandom(3) });
  const stored = createStoredIntents({ ...test.stores, ids, publish: () => undefined });
  const snapshot = await stored.snapshot(view.intent, live);
  const curves = createVenueHost({
    venues: readWith,
    chains: testChains(["fake-curve"]),
    clock: test.clock,
    callTimeoutMs: 5_000,
  });
  const parts = withoutCurves === true ? { stores: test.stores } : { stores: test.stores, curves };
  return snapshot === undefined
    ? "no intent"
    : launchTargetsOf(snapshot.record, parts, live.signal);
}

const none = { kind: "none" };

describe("the launch contracts a step may reach", () => {
  it("names the launch's curve for the launch wallet's buy on it, read again", async () => {
    await expect(targetsOf(await engine())).resolves.toStrictEqual({
      kind: "read",
      launch: [launchCurve],
    });
  });

  it("names none for another wallet's buy on the curve, or without the launchpads' reads", async () => {
    await expect(targetsOf(await engine(), { wallet: testWallet })).resolves.toStrictEqual(none);
    await expect(targetsOf(await engine(), { withoutCurves: true })).resolves.toStrictEqual(none);
  });

  it("is launch_moved once the token left the curve, as after a graduation", async () => {
    const test = await engine();

    const read = await targetsOf(test, { readWith: graduated });

    expect(read).toStrictEqual({ kind: "failed", reason: "launch_moved" });
  });
});
