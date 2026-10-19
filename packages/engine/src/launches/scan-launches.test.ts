import { describe, expect, it } from "vitest";
import { expectOk, testCoin } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import {
  hourMs,
  launchChain as chain,
  launchToken as tokenOf,
  withLaunches,
} from "./test-launches.js";

describe("market/scan of launches", () => {
  it("reads the launch feed's launches of the last 24 hours, newest first", async () => {
    const test = await withLaunches({ launchFeed: true });
    const args = { chain, source: "launches", filters: { maxInsiders: 1 } } as const;
    const scan = expectOk(await test.engine.handlers["market/scan"](testCall(args)));
    expect(scan.items).toStrictEqual([
      {
        asset: tokenOf(3),
        launchpad: "fake-curve",
        launchedAt: test.clock.now() - hourMs,
        graduated: false,
      },
      {
        asset: tokenOf(2),
        launchpad: "fake-curve",
        launchedAt: test.clock.now() - 10 * hourMs,
        graduated: false,
      },
    ]);
    expect(Object.keys(scan.assets).toSorted()).toStrictEqual(
      [testCoin, tokenOf(2), tokenOf(3)].toSorted(),
    );
  });

  it("fails with no launch feed, and refuses a launchpad the engine does not run", async () => {
    const off = await withLaunches();
    const args = { chain, source: "launches" } as const;
    expect(await off.engine.handlers["market/scan"](testCall(args))).toStrictEqual({
      ok: false,
      error: "market.no_launch_feed",
    });
    const on = await withLaunches({ launchFeed: true });
    const nowhere = { ...args, filters: { launchpads: ["nowhere"] } };
    expect(await on.engine.handlers["market/scan"](testCall(nowhere))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const deep = { ...args, filters: { minLiquidityUsdMicros: 1n } };
    expect(expectOk(await on.engine.handlers["market/scan"](testCall(deep)))).toStrictEqual({
      items: [],
      assets: {},
    });
  });
});
