import assert from "node:assert/strict";
import { type AssetRef, assetRefSchema } from "@binference/chain";
import { priceSourceContract } from "@binference/chain/testing";
import { err, mulDiv, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { addressSchema } from "../rpc/evm-wire.schema.js";
import {
  createFakeRpcHttp,
  type FakeEndpoint,
  type FakeRpcAnswer,
  fakeRpcNode,
} from "../testing/fake-rpc-http.js";
import { createChainlinkPrices } from "./chainlink-prices.js";
import type { FeedAsset } from "./price-from-round.js";

const url = "https://node.invalid/";

// latestRoundData() of three BSC feed proxies at block 126,255,596 (2026-10-07 12:55:09 UTC), read
// with `cast call <proxy> 'latestRoundData()' --block 126255596`.
const recordedAtMs = 1_791_377_709_000;
const recorded = {
  bnb: "0x00000000000000000000000000000000000000000000000300000000003545d900000000000000000000000000000000000000000000000000000011d7d3e058000000000000000000000000000000000000000000000000000000006ac6410f000000000000000000000000000000000000000000000000000000006ac6411000000000000000000000000000000000000000000000000300000000003545d9",
  usdt: "0x00000000000000000000000000000000000000000000000400000000000011d70000000000000000000000000000000000000000000000000000000005f5623f000000000000000000000000000000000000000000000000000000006ac63f82000000000000000000000000000000000000000000000000000000006ac63f8e00000000000000000000000000000000000000000000000400000000000011d7",
  fdusd:
    "0x00000000000000000000000000000000000000000000000200000000000003880000000000000000000000000000000000000000000000000000000005f4309d000000000000000000000000000000000000000000000000000000006ac55f3e000000000000000000000000000000000000000000000000000000006ac55f4b0000000000000000000000000000000000000000000000020000000000000388",
} as const;
// The BNB/USD answer recorded above, $766.35431 with 8 decimals, updated 29 s before its block.
const bnbAnswer = 76_635_431_000n;
const bnbUpdatedAtMs = 1_791_377_680_000;

const feeds = {
  bnb: addressSchema.parse("0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"),
  usdt: addressSchema.parse("0xB97Ad0E74fa7d920791E90258A6E2085088b4320"),
  fdusd: addressSchema.parse("0x390180e80058A8499930F0c13963AD3E0d86Bfc9"),
};
const bnb = assetRefSchema.parse("eip155:56/slip44:714");
const usdt = assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955");
const fdusd = assetRefSchema.parse("eip155:56/erc20:0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409");
const wbnb = assetRefSchema.parse("eip155:56/erc20:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");

function feedAsset(asset: AssetRef, feed: keyof typeof feeds, heartbeatSeconds: number) {
  return {
    asset,
    decimals: 18,
    isStablecoin: feed !== "bnb",
    feed: { address: feeds[feed], decimals: 8, heartbeatSeconds },
  } satisfies FeedAsset;
}

const assets: readonly FeedAsset[] = [
  feedAsset(bnb, "bnb", 27),
  feedAsset(usdt, "usdt", 900),
  feedAsset(fdusd, "fdusd", 86_400),
];

const ethCallSchema = z.tuple([z.looseObject({ to: z.string() }), z.literal("latest")]);

// A node that answers each feed's eth_call with its recorded round, or with `answers` first.
function recordedNode(answers: Readonly<Record<string, FakeRpcAnswer>> = {}): FakeEndpoint {
  const byFeed: Readonly<Record<string, FakeRpcAnswer>> = {
    [feeds.bnb]: { result: recorded.bnb },
    [feeds.usdt]: { result: recorded.usdt },
    [feeds.fdusd]: { result: recorded.fdusd },
    ...answers,
  };
  return fakeRpcNode(({ params }) => {
    const [{ to }] = ethCallSchema.parse(params);
    return byFeed[to] ?? { error: { code: 3, message: "execution reverted" } };
  });
}

function setup(endpoint: FakeEndpoint = recordedNode(), nowMs = recordedAtMs) {
  const clock = createManualClock(nowMs);
  const http = createFakeRpcHttp({ [url]: endpoint });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock,
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { source: createChainlinkPrices({ rpc, clock, assets }), http, rpc, clock };
}

const live = { signal: new AbortController().signal };
const dollar = ok({ numerator: 1_000_000n, denominator: 10n ** 18n });

describe("the Chainlink price source", () => {
  it.each(
    priceSourceContract({ create: () => ({ source: setup().source, known: bnb, unknown: wbnb }) }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices BNB at its feed's answer, in micro-dollars per wei", async () => {
    const price = await setup().source.usdPrice(bnb, live);
    expect(price).toStrictEqual(ok({ numerator: bnbAnswer * 1_000_000n, denominator: 10n ** 26n }));
    assert.ok(price.ok);
    // One BNB is $766.35431.
    expect(mulDiv(10n ** 18n, price.value, "down")).toBe(766_354_310n);
  });

  it("prices USDT at $1 while its feed holds the peg", async () => {
    await expect(setup().source.usdPrice(usdt, live)).resolves.toStrictEqual(dollar);
  });

  it("prices FDUSD at $1 hours after its daily feed last moved", async () => {
    await expect(setup().source.usdPrice(fdusd, live)).resolves.toStrictEqual(dollar);
  });

  it("prices BNB until its answer is older than the 27 s heartbeat plus 30 s", async () => {
    const lastFresh = setup(recordedNode(), bnbUpdatedAtMs + 57_000).source;
    const firstStale = setup(recordedNode(), bnbUpdatedAtMs + 57_001).source;
    await expect(lastFresh.usdPrice(bnb, live)).resolves.toMatchObject({ ok: true });
    await expect(firstStale.usdPrice(bnb, live)).resolves.toStrictEqual(err("no_price"));
  });

  it("has no price for an asset without a feed, and asks no node", async () => {
    const { source, http } = setup();
    await expect(source.usdPrice(wbnb, live)).resolves.toStrictEqual(err("no_price"));
    expect(http.requests()).toHaveLength(0);
  });

  it.each<[string, FakeEndpoint]>([
    [
      "the feed's read reverts",
      recordedNode({ [feeds.bnb]: { error: { code: 3, message: "execution reverted" } } }),
    ],
    ["the feed answers in another shape", recordedNode({ [feeds.bnb]: { result: "0x" } })],
    ["no endpoint answers", "refuse"],
  ])("has no price when %s", async (_case, endpoint) => {
    await expect(setup(endpoint).source.usdPrice(bnb, live)).resolves.toStrictEqual(
      err("no_price"),
    );
  });

  it("rejects with the signal's reason when it aborts during the read", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const asked = setup("hang").source.usdPrice(bnb, { signal: controller.signal });
    controller.abort(reason);
    await expect(asked).rejects.toBe(reason);
  });

  it("refuses two feeds for one asset", () => {
    const { rpc, clock } = setup();
    const twice = [...assets, feedAsset(usdt, "fdusd", 86_400)];
    expect(() => createChainlinkPrices({ rpc, clock, assets: twice })).toThrow(
      expect.objectContaining({ code: "chain.bad_price_feeds" }),
    );
  });
});
