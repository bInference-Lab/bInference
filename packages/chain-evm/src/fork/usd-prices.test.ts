import type { PriceSource } from "@binference/chain";
import { err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { type Address, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { erc20AssetRef } from "../evm-chain.js";
import { createChainlinkPrices } from "../prices/chainlink-prices.js";
import { bscContract, bscToken } from "./bsc-addresses.js";
import { bscFeedAssets } from "./bsc-feed-assets.js";
import { type FixtureRound, encodeFixtureRound } from "./fixture-round.js";
import type { Fork } from "./open-fork.js";
import { withFork } from "./with-fork.js";

const proxyAbi = parseAbi([
  "function aggregator() view returns (address)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const usdtFeed = bscContract("chainlink", "usdt-usd");
const bnbFeed = bscContract("chainlink", "bnb-usd");
const dollar = ok({ numerator: 1_000_000n, denominator: 10n ** 18n });

interface Priced {
  readonly prices: PriceSource;
  /** The fork block's time, in seconds. */
  readonly blockSeconds: bigint;
}

const epochMsSchema = z.coerce.number<bigint>().int().nonnegative();

// The prices as the fork block saw them: the clock stands at the block's time.
async function pricesOn(fork: Fork): Promise<Priced> {
  const { timestamp } = await fork.client.getBlock({ blockNumber: fork.block });
  const clock = createManualClock(epochMsSchema.parse(timestamp * 1_000n));
  const assets = bscFeedAssets(fork.chain);
  return {
    prices: createChainlinkPrices({ rpc: fork.rpc, clock, assets }),
    blockSeconds: timestamp,
  };
}

async function answerOf(fork: Fork, feed: Address): Promise<bigint> {
  const [, answer] = await fork.client.readContract({
    address: feed,
    abi: proxyAbi,
    functionName: "latestRoundData",
  });
  return answer;
}

// The fixture replaces the aggregator, so the read still goes through the feed's own proxy.
async function setRound(fork: Fork, feed: Address, round: FixtureRound): Promise<void> {
  const aggregator = await fork.client.readContract({
    address: feed,
    abi: proxyAbi,
    functionName: "aggregator",
  });
  await fork.call("anvil_setCode", [aggregator, encodeFixtureRound(round)]);
}

describe("the Chainlink price source on a BSC fork", () => {
  it("prices BNB and WBNB at the BNB feed's answer and USDT at $1 while its feed holds the peg", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { prices } = await pricesOn(fork);
      const usdt = erc20AssetRef(fork.chain, bscToken("USDT"));
      const wbnb = erc20AssetRef(fork.chain, bscToken("WBNB"));
      const bnbAnswer = await answerOf(fork, bnbFeed);
      const usdtAnswer = await answerOf(fork, usdtFeed);
      const bnbPrice = ok({ numerator: bnbAnswer * 1_000_000n, denominator: 10n ** 26n });

      await expect(prices.usdPrice(fork.chain.nativeAsset, { signal })).resolves.toStrictEqual(
        bnbPrice,
      );
      await expect(prices.usdPrice(wbnb, { signal })).resolves.toStrictEqual(bnbPrice);
      expect(usdtAnswer).toBeGreaterThan(98_000_000n);
      expect(usdtAnswer).toBeLessThan(102_000_000n);
      await expect(prices.usdPrice(usdt, { signal })).resolves.toStrictEqual(dollar);
    }));

  it("switches USDT to its feed's price once a depeg fixture moves the feed past 2%", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { prices, blockSeconds } = await pricesOn(fork);
      const usdt = erc20AssetRef(fork.chain, bscToken("USDT"));

      await setRound(fork, usdtFeed, { answer: 98_500_000n, updatedAtSeconds: blockSeconds });
      await expect(prices.usdPrice(usdt, { signal })).resolves.toStrictEqual(dollar);

      await setRound(fork, usdtFeed, { answer: 97_000_000n, updatedAtSeconds: blockSeconds });
      await expect(answerOf(fork, usdtFeed)).resolves.toBe(97_000_000n);
      await expect(prices.usdPrice(usdt, { signal })).resolves.toStrictEqual(
        ok({ numerator: 97_000_000n * 1_000_000n, denominator: 10n ** 26n }),
      );
    }));

  it("has no price for USDT once its feed is older than its 900 s heartbeat plus 30 s", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { prices, blockSeconds } = await pricesOn(fork);
      const usdt = erc20AssetRef(fork.chain, bscToken("USDT"));

      await setRound(fork, usdtFeed, {
        answer: 99_990_000n,
        updatedAtSeconds: blockSeconds - 930n,
      });
      await expect(prices.usdPrice(usdt, { signal })).resolves.toStrictEqual(dollar);

      await setRound(fork, usdtFeed, {
        answer: 99_990_000n,
        updatedAtSeconds: blockSeconds - 931n,
      });
      await expect(prices.usdPrice(usdt, { signal })).resolves.toStrictEqual(err("no_price"));
    }));
});
