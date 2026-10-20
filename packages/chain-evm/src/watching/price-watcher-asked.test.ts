import { type AssetRef, accountRefSchema, assetRefSchema } from "@binference/chain";
import { ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { encodeAbiParameters, getAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { FeedAsset } from "../prices/price-from-round.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp } from "../testing/fake-rpc-http.js";
import { createBlockSource } from "./block-source.js";
import { poolPrice, reservesCall } from "./pool-state.js";
import { createPriceWatcher, type WatchedPrice } from "./price-watcher.js";

const startMs = 1_800_000_000_000;
const blockTimeMs = 450;
const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const pool = getAddress("0x0000000000000000000000000000000000100001");
const feedAddress = getAddress("0x00000000000000000000000000000000000000fe");
const quote = assetRefSchema.parse("eip155:56/erc20:0x00000000000000000000000000000000000000f1");
const token: AssetRef = assetRefSchema.parse(
  "eip155:56/erc20:0x0000000000000000000000000000000000001001",
);
const feed: FeedAsset = {
  asset: quote,
  decimals: 18,
  isStablecoin: false,
  feed: { address: feedAddress, decimals: 8, heartbeatSeconds: 60 },
};

// A pool's reserves and the feed's round, as the fake node answers each call.
function answerOf(target: string): Hex {
  return target === feedAddress
    ? encodeAbiParameters(
        [
          { type: "uint80" },
          { type: "int256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint80" },
        ],
        [1n, 600n * 10n ** 8n, 0n, BigInt(startMs / 1_000), 1n],
      )
    : encodeAbiParameters(
        [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
        [10n, 1_000n, 0],
      );
}

describe("a price's stamps", () => {
  it("keeps when its read was asked apart from when it was answered", async () => {
    const clock = createManualClock(startMs);
    const node = createFakeEvmNode({
      multicall,
      head: 100n,
      answer: (read) => answerOf(read.target),
    });
    const http = createFakeRpcHttp({ "https://node.test": node.endpoint });
    // Every answer takes 400 ms of the clock, as a slow node's would.
    const slow = {
      request: async (request: Parameters<typeof http.request>[0]) => {
        await clock.sleep(400, request.signal);
        return http.request(request);
      },
    };
    const rpc = createRpcFailover({
      endpoints: [{ name: "node", url: "https://node.test" }],
      http: slow,
      clock,
      timeoutMs: 1_000,
      restMs: 1,
    });
    const calls = [{ target: accountRefSchema.parse(`eip155:56:${pool}`), input: reservesCall }];
    const read = {
      depthUsdMicros: 50_000_000_000n,
      quoteAsset: quote,
      calls,
      price: (answers: Parameters<typeof poolPrice>[1]) =>
        poolPrice({ kind: "v2", isToken0: true }, answers),
    };
    const watcher = createPriceWatcher({
      rpc,
      blocks: createBlockSource({ rpc, clock, blockTimeMs }),
      clock,
      multicall,
      blockTimeMs,
      planPrices: async () => Promise.resolve(ok({ source: "test-pools", read })),
      feeds: [feed],
    });
    const prices: WatchedPrice[] = [];
    watcher.onPrice((price) => prices.push(price));
    const stop = new AbortController();
    const running = watcher.run(stop.signal).catch(() => undefined);
    watcher.watch(token);

    await clock.advance(1_000);
    node.setHead(101n);
    await clock.advance(3_000);
    stop.abort();
    await running;

    expect(prices.map(({ atMs, askedAtMs }) => atMs - askedAtMs)).toContain(400);
  });
});
