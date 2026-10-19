import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import type { StoredLaunch } from "./launch-record.js";
import { launchViewOf } from "./launch-view-of.js";
import { launchChain, launchCreator, launchToken, launchTx } from "./test-launches.js";

const unlisted = assetRefSchema.parse("fake:1/token:0x000000f0");

// A launch the feed read with no words and an unlisted quote token, its curve moved.
const launch: StoredLaunch = {
  chain: launchChain,
  token: launchToken(1),
  launchpad: "fake-curve",
  creator: launchCreator,
  quoteToken: unlisted,
  snipeTaxBps: bpsSchema.parse(9_900),
  curveProgressBps: bpsSchema.parse(1_250),
  graduated: true,
  insiders: [],
  block: 7n,
  blockHash: "0x07",
  txHash: launchTx(7),
  logIndex: 3,
  launchedAtMs: 1_800_000_000_000,
  changedAtMs: 1_800_000_001_000,
  creatorLaunches30d: 4,
};

describe("launchViewOf", () => {
  it("shows a launch's curve and snipe tax, and no info of a token whose decimals were not read", () => {
    expect(launchViewOf(testChains(), launch)).toStrictEqual({
      chain: launchChain,
      token: launchToken(1),
      launchpad: "fake-curve",
      creator: launchCreator,
      quoteToken: unlisted,
      snipeTaxBps: 9_900,
      curveProgressBps: 1_250,
      graduated: true,
      insiders: [],
      creatorLaunches30d: 4,
      block: 7,
      tx: launchTx(7),
      launchedAt: 1_800_000_000_000,
      assets: {},
    });
  });

  it("names a token by the words its creator wrote, off its curve once graduated, and a listed quote token", () => {
    const worded = { ...launch, decimals: 9, quoteToken: testCoin };
    expect(launchViewOf(testChains(), worded).assets).toStrictEqual({
      [launchToken(1)]: { symbol: "", name: "", decimals: 9, verified: false, onCurve: false },
      [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
    });
  });
});
