import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { createFakeLaunchpad, createFakeVenue } from "@binference/chain/testing";
import { bpsSchema } from "@binference/core";
import { testCoin } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testChains,
} from "../operations/test-engine.js";
import type { NewLaunch } from "./launch-record.js";

// Launches of the fake curve on the fake chain, stored as the launch feed stores them, for the
// tests of the launch reads.

/** The fake chain. */
export const launchChain: ChainRef = chainRefSchema.parse("fake:1");

/** The creator of every test launch. */
export const launchCreator: AccountRef = accountRefSchema.parse("fake:1:0x000000c1");

/** An hour, in milliseconds. */
export const hourMs: number = 3_600_000;

/** The token of test launch `n`. */
export function launchToken(n: number): AssetRef {
  return assetRefSchema.parse(`fake:1/token:0x${(0xe0 + n).toString(16).padStart(8, "0")}`);
}

/** The transaction of test launch `n`. */
export function launchTx(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  if (!isTxHash(hash)) {
    throw new Error("Not a hash.");
  }
  return hash;
}

// Launch `n` on the fake curve, `hoursAgo` hours before the test's time, at block `n`.
function launchOf(test: TestEngine, n: number, hoursAgo: number): NewLaunch {
  return {
    token: launchToken(n),
    launchpad: "fake-curve",
    creator: launchCreator,
    quoteToken: testCoin,
    symbol: `L${String(n)}`,
    name: `Launch ${String(n)}`,
    decimals: 18,
    taxBps: bpsSchema.parse(n * 100),
    graduated: false,
    insiders: [launchCreator],
    block: BigInt(n),
    blockHash: `0x${n.toString(16).padStart(64, "0")}`,
    txHash: launchTx(n),
    logIndex: 0,
    launchedAtMs: test.clock.now() - hoursAgo * hourMs,
  };
}

/**
 * A test engine whose venue host runs the fake curve, with the fake curve's launches 1 to 3 made
 * 30, 10 and 1 hours ago stored.
 */
export async function withLaunches(): Promise<TestEngine> {
  const test = await startTestEngine({
    chains: testChains(["fake-curve"]),
    venues: [createFakeVenue(), createFakeLaunchpad({ onCurve: [] })],
  });
  const launches = [launchOf(test, 1, 30), launchOf(test, 2, 10), launchOf(test, 3, 1)];
  const atMs = test.clock.now();
  const read = {
    chain: launchChain,
    from: 1n,
    to: 3n,
    toHash: "0x03",
    atMs,
    launches,
    changes: [],
  };
  await test.stores.launches.record(read, testCall({}));
  return test;
}
