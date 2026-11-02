import assert from "node:assert/strict";
import type { PriceSource } from "@binference/chain";
import { bsc, bscRatePrices } from "@binference/chains";
import { err, mulDiv, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { type Address, parseAbi, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { erc20AssetRef } from "../evm-chain.js";
import { createChainlinkPrices } from "../prices/chainlink-prices.js";
import { rateAssetsOf } from "../prices/rate-assets.js";
import { createRatePrices } from "../prices/rate-prices.js";
import { bscContract, bscToken } from "./bsc-addresses.js";
import { bscFeedAssets } from "./bsc-feed-assets.js";
import { encodeFixtureRound, type FixtureRound } from "./fixture-round.js";
import type { Fork } from "./open-fork.js";
import { withFork } from "./with-fork.js";

const managerAbi = parseAbi([
  "function convertSnBnbToBnb(uint256) view returns (uint256)",
  "function getTotalPooledBnb() view returns (uint256)",
  "function paused() view returns (bool)",
]);
const tokenAbi = parseAbi(["function totalSupply() view returns (uint256)"]);
const feedAbi = parseAbi([
  "function aggregator() view returns (address)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);

const manager = bscContract("lista", "stake-manager");
const slisBnb = bscToken("slisBNB");
const bnbFeed = bscContract("chainlink", "bnb-usd");
const rateFeed = bscContract("chainlink", "slisbnb-bnb-exchange-rate");
const whole = 10n ** 18n;
// PausableUpgradeable's `_paused` sits after Initializable's slot and Context's 50-slot gap.
const pausedSlot = toHex(51n, { size: 32 });

const epochMsSchema = z.coerce.number<bigint>().int().nonnegative();

interface Priced {
  readonly prices: PriceSource;
  readonly blockSeconds: bigint;
}

// The prices as the fork block saw them: the clock stands at the block's time.
async function pricesOn(fork: Fork): Promise<Priced> {
  const { timestamp } = await fork.client.getBlock({ blockNumber: fork.block });
  const clock = createManualClock(epochMsSchema.parse(timestamp * 1_000n));
  const feeds = createChainlinkPrices({ rpc: fork.rpc, clock, assets: bscFeedAssets() });
  const prices = createRatePrices({
    rpc: fork.rpc,
    multicall: bscContract("multicall3", "multicall3"),
    clock,
    timeoutMs: 10_000,
    prices: feeds,
    assets: rateAssetsOf(bsc, bscRatePrices),
  });
  return { prices, blockSeconds: timestamp };
}

// The aggregator behind a feed's proxy answers `round` from now on.
async function setRound(fork: Fork, feed: Address, round: FixtureRound): Promise<void> {
  const aggregator = await fork.client.readContract({
    address: feed,
    abi: feedAbi,
    functionName: "aggregator",
  });
  await fork.call("anvil_setCode", [aggregator, encodeFixtureRound(round)]);
}

const refused = err("price_refused");

describe("slisBNB's price on a BSC fork", () => {
  it("is BNB's feed price times the stake manager's rate, which is pooled BNB per slisBNB", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { prices, blockSeconds } = await pricesOn(fork);
      const asset = erc20AssetRef(fork.chain, slisBnb);
      const [rate, pooled, supply, paused, [, answer], feedDecimals, rateRound] = await Promise.all(
        [
          fork.client.readContract({
            address: manager,
            abi: managerAbi,
            functionName: "convertSnBnbToBnb",
            args: [whole],
          }),
          fork.client.readContract({
            address: manager,
            abi: managerAbi,
            functionName: "getTotalPooledBnb",
          }),
          fork.client.readContract({
            address: slisBnb,
            abi: tokenAbi,
            functionName: "totalSupply",
          }),
          fork.client.readContract({ address: manager, abi: managerAbi, functionName: "paused" }),
          fork.client.readContract({
            address: bnbFeed,
            abi: feedAbi,
            functionName: "latestRoundData",
          }),
          fork.client.readContract({ address: rateFeed, abi: feedAbi, functionName: "decimals" }),
          fork.client.readContract({
            address: rateFeed,
            abi: feedAbi,
            functionName: "latestRoundData",
          }),
        ],
      );
      expect(paused).toBe(false);
      // Chainlink's slisBNB / BNB feed answers the same rate in 18 decimals, within a day.
      const [, feedRate, , feedUpdatedAt] = rateRound;
      expect(feedDecimals).toBe(18);
      expect(feedRate * 100n).toBeGreaterThanOrEqual(rate * 99n);
      expect(feedRate * 100n).toBeLessThanOrEqual(rate * 101n);
      expect(blockSeconds - feedUpdatedAt).toBeLessThanOrEqual(86_430n);
      expect(rate).toBe((whole * pooled) / supply);
      expect(rate).toBeGreaterThan(whole);
      expect(rate).toBeLessThan((whole * 12n) / 10n);

      const price = await prices.usdPrice(asset, { signal });
      expect(price).toStrictEqual(
        ok({ numerator: answer * 1_000_000n * rate, denominator: 10n ** 8n * whole * whole }),
      );
      // One whole slisBNB, in micro-dollars, within one of the rate times BNB's dollar price.
      assert.ok(price.ok);
      const bnbMicros = (answer * 1_000_000n) / 10n ** 8n;
      const slisMicros = mulDiv(whole, price.value, "down");
      expect(slisMicros - (bnbMicros * rate) / whole).toBeGreaterThanOrEqual(0n);
      expect(slisMicros - (bnbMicros * rate) / whole).toBeLessThanOrEqual(1n);
    }));

  it("refuses a price once BNB's feed is older than its heartbeat plus 30 s", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const { blockSeconds } = await pricesOn(fork);
      const asset = erc20AssetRef(fork.chain, slisBnb);
      await setRound(fork, bnbFeed, {
        answer: 60_000_000_000n,
        updatedAtSeconds: blockSeconds - 58n,
      });
      const { prices } = await pricesOn(fork);
      await expect(prices.usdPrice(asset, { signal })).resolves.toStrictEqual(refused);
    }));

  it("refuses a price while the stake manager is paused", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const asset = erc20AssetRef(fork.chain, slisBnb);
      await expect(
        (await pricesOn(fork)).prices.usdPrice(asset, { signal }),
      ).resolves.toMatchObject({
        ok: true,
      });
      await fork.call("anvil_setStorageAt", [manager, pausedSlot, toHex(1n, { size: 32 })]);
      await expect(
        fork.client.readContract({ address: manager, abi: managerAbi, functionName: "paused" }),
      ).resolves.toBe(true);
      const { prices } = await pricesOn(fork);
      await expect(prices.usdPrice(asset, { signal })).resolves.toStrictEqual(refused);
    }));

  it("refuses a price when Chainlink's slisBNB feed is 1% off the rate, or stale", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { blockSeconds } = await pricesOn(fork);
      const asset = erc20AssetRef(fork.chain, slisBnb);
      // A fresh feed that says one slisBNB is one BNB, about 3.9% under the stake manager.
      await setRound(fork, rateFeed, { answer: whole, updatedAtSeconds: blockSeconds });
      await expect(
        (await pricesOn(fork)).prices.usdPrice(asset, { signal }),
      ).resolves.toStrictEqual(refused);
      const rate = await fork.client.readContract({
        address: manager,
        abi: managerAbi,
        functionName: "convertSnBnbToBnb",
        args: [whole],
      });
      await setRound(fork, rateFeed, { answer: rate, updatedAtSeconds: blockSeconds - 86_431n });
      await expect(
        (await pricesOn(fork)).prices.usdPrice(asset, { signal }),
      ).resolves.toStrictEqual(refused);
      await setRound(fork, rateFeed, { answer: rate, updatedAtSeconds: blockSeconds });
      await expect(
        (await pricesOn(fork)).prices.usdPrice(asset, { signal }),
      ).resolves.toMatchObject({
        ok: true,
      });
    }));
});
