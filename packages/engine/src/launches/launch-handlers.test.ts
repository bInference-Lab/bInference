import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { expectOk, testCoin } from "../intents/test-intents.js";
import { type TestEngine, testCall } from "../operations/test-engine.js";
import {
  hourMs,
  launchChain as chain,
  launchCreator as creator,
  launchToken as tokenOf,
  launchTx as txOf,
  withLaunches,
} from "./test-launches.js";

const listOf = async (test: TestEngine, args: object) =>
  test.engine.handlers["launch/list"](testCall({ chain, ...args }));

describe("launch/list", () => {
  it("answers the launches newest first, each with its token's words unverified and its quote token's info", async () => {
    const test = await withLaunches();
    const page = expectOk(await listOf(test, {}));
    expect(page.items.map(({ token }) => token)).toStrictEqual([
      tokenOf(3),
      tokenOf(2),
      tokenOf(1),
    ]);
    expect(page.items[0]).toStrictEqual({
      chain,
      token: tokenOf(3),
      launchpad: "fake-curve",
      creator,
      quoteToken: testCoin,
      taxBps: 300,
      graduated: false,
      insiders: [creator],
      creatorLaunches30d: 2,
      block: 3,
      tx: txOf(3),
      launchedAt: test.clock.now() - hourMs,
      assets: {
        [tokenOf(3)]: {
          symbol: "L3",
          name: "Launch 3",
          decimals: 18,
          verified: false,
          onCurve: true,
        },
        [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
      },
    });
    expect(page.next).toBeUndefined();
  });

  it("pages with its cursor, reads from a time and through the filters", async () => {
    const test = await withLaunches();
    const first = expectOk(await listOf(test, { limit: 2 }));
    expect(first.items.map(({ token }) => token)).toStrictEqual([tokenOf(3), tokenOf(2)]);
    const second = expectOk(await listOf(test, { limit: 2, cursor: first.next }));
    expect(second.items.map(({ token }) => token)).toStrictEqual([tokenOf(1)]);
    const recent = expectOk(await listOf(test, { from: test.clock.now() - 12 * hourMs }));
    expect(recent.items).toHaveLength(2);
    const cheap = expectOk(
      await listOf(test, { filters: { maxTaxBps: 100, launchpads: ["fake-curve"] } }),
    );
    expect(cheap.items.map(({ token }) => token)).toStrictEqual([tokenOf(1)]);
    const deep = expectOk(await listOf(test, { filters: { minLiquidityUsdMicros: 1n } }));
    expect(deep.items).toStrictEqual([]);
  });

  it("refuses a launchpad the engine does not run, a chain or quote token the registry does not hold, and a cursor it did not write", async () => {
    const test = await withLaunches();
    const refused = await Promise.all([
      listOf(test, { filters: { launchpads: ["fake-swap"] } }),
      listOf(test, { filters: { launchpads: ["nowhere"] } }),
      listOf(test, { filters: { quoteTokens: [assetRefSchema.parse("fake:9/slip44:1")] } }),
      test.engine.handlers["launch/list"](testCall({ chain: chainRefSchema.parse("fake:9") })),
      listOf(test, { cursor: "not-a-cursor" }),
    ]);
    expect(refused).toStrictEqual(refused.map(() => ({ ok: false, error: "protocol.bad_args" })));
  });
});
