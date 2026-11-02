import assert from "node:assert/strict";
import { assetRefSchema, type UsdPrice } from "@binference/chain";
import { err, mulDiv, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  type Hex,
  parseAbiParameters,
  toFunctionSelector,
} from "viem";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp } from "../testing/fake-rpc-http.js";
import { latestRoundDataCall } from "./feed-round.schema.js";
import type { RateAsset } from "./rate-assets.js";
import { createRatePrices } from "./rate-prices.js";

const url = "https://node.invalid/";
const multicall = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
const converter = getAddress("0x1adB950d8bB3dA4bE104211D5AB038628e477fE6");
const rateFeed = getAddress("0xea93C82fa07773ed645d8A79eE27041eb867f221");
const coin = assetRefSchema.parse("eip155:56/slip44:714");
const staked = assetRefSchema.parse("eip155:56/erc20:0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B");
const coinPrice: UsdPrice = { numerator: 76_635_431_000n * 1_000_000n, denominator: 10n ** 26n };
const heartbeatSeconds = 86_400;
const nowSeconds = 1_800_000_000n;
const nowMs = 1_800_000_000_000;
const live = { signal: new AbortController().signal };

const word = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);
const roundOf = (answer: bigint, updatedAtSeconds: bigint): Hex =>
  encodeAbiParameters(parseAbiParameters("uint80, int256, uint256, uint256, uint80"), [
    1n,
    answer,
    updatedAtSeconds,
    updatedAtSeconds,
    1n,
  ]);

/** A token's registry entry and what the chain answers for it. */
interface Case {
  readonly tokenDecimals: number;
  readonly coinDecimals: number;
  /** The feed's decimals past the coin's, so a feed answer can state the rate exactly. */
  readonly feedExtraDecimals: number;
  readonly minRateBps: number;
  readonly maxRateBps: number;
  readonly maxGapBps: number;
  /** Where the rate sits between its bounds, in millionths of the span. */
  readonly spot: number;
}

const cases: fc.Arbitrary<Case> = fc
  .record({
    tokenDecimals: fc.integer({ min: 0, max: 24 }),
    coinDecimals: fc.integer({ min: 4, max: 24 }),
    feedExtraDecimals: fc.integer({ min: 0, max: 6 }),
    minRateBps: fc.integer({ min: 1, max: 20_000 }),
    spanBps: fc.integer({ min: 1, max: 20_000 }),
    maxGapBps: fc.integer({ min: 1, max: 1_000 }),
    spot: fc.integer({ min: 0, max: 1_000_000 }),
  })
  .map((item): Case => ({
    tokenDecimals: item.tokenDecimals,
    coinDecimals: item.coinDecimals,
    feedExtraDecimals: item.feedExtraDecimals,
    minRateBps: item.minRateBps,
    maxRateBps: item.minRateBps + item.spanBps,
    maxGapBps: item.maxGapBps,
    spot: item.spot,
  }));

const unitOf = (decimals: number) => 10n ** BigInt(decimals);

// The least and the most coin base units one whole token may convert to.
function boundsOf(item: Case): { readonly least: bigint; readonly most: bigint } {
  const coinUnit = unitOf(item.coinDecimals);
  return {
    least: (BigInt(item.minRateBps) * coinUnit + 9_999n) / 10_000n,
    most: (BigInt(item.maxRateBps) * coinUnit) / 10_000n,
  };
}

// The coin base units one whole token converts to at `spot` between the bounds, bounds included.
function rateIn(item: Case): bigint {
  const { least, most } = boundsOf(item);
  return least + ((most - least) * BigInt(item.spot)) / 1_000_000n;
}

// A rate one wei or more under the least, from zero up, at `spot` of that stretch.
const rateUnder = (item: Case) => ((boundsOf(item).least - 1n) * BigInt(item.spot)) / 1_000_000n;

// The feed's answer stating `rate` exactly in the feed's decimals.
const feedOf = (item: Case, rate: bigint) => rate * unitOf(item.feedExtraDecimals);

interface Chain {
  readonly rate: bigint;
  readonly feedAnswer: bigint;
  readonly feedAgeSeconds: bigint;
}

async function priceOf(item: Case, chain: Chain) {
  const unit = unitOf(item.tokenDecimals);
  const convertCall = concatHex([toFunctionSelector("function toCoin(uint256)"), word(unit)]);
  const asset: RateAsset = {
    asset: staked,
    coin,
    unit,
    coinUnit: unitOf(item.coinDecimals),
    converter,
    convertCall,
    minRateBps: item.minRateBps,
    maxRateBps: item.maxRateBps,
    checkFeed: {
      address: rateFeed,
      feedUnit: unitOf(item.coinDecimals + item.feedExtraDecimals),
      heartbeatSeconds,
      maxGapBps: item.maxGapBps,
    },
  };
  const round = roundOf(chain.feedAnswer, nowSeconds - chain.feedAgeSeconds);
  const answers = new Map<string, Hex>([
    [convertCall, word(chain.rate)],
    [latestRoundDataCall, round],
  ]);
  const node = createFakeEvmNode({
    multicall,
    head: 9n,
    // The block's time is now and the contract is not paused: both answer one word.
    answer: ({ target, callData }) =>
      answers.get(callData) ?? (target === multicall ? word(nowSeconds) : word(0n)),
  });
  const clock = createManualClock(nowMs);
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http: createFakeRpcHttp({ [url]: node.endpoint }),
    clock,
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  const prices = { usdPrice: async () => ok(coinPrice) };
  const parts = { rpc, multicall, clock, timeoutMs: 3_000, prices, assets: [asset] };
  return { price: await createRatePrices(parts).usdPrice(staked, live), unit };
}

const agreeing = (item: Case) => {
  const rate = rateIn(item);
  return { rate, feedAnswer: feedOf(item, rate), feedAgeSeconds: 0n };
};

describe("the rate price source's invariants", () => {
  it("prices a rate within its bounds that its feed agrees with at the coin's value of it", async () => {
    await fc.assert(
      fc.asyncProperty(cases, fc.bigInt({ min: 0n, max: 10n ** 30n }), async (item, amount) => {
        const chain = agreeing(item);
        const { price, unit } = await priceOf(item, chain);
        assert.ok(price.ok);
        expect(price.value).toStrictEqual({
          numerator: coinPrice.numerator * chain.rate,
          denominator: coinPrice.denominator * unit,
        });
        // The policy's value of any amount at it is the exact value rounded up, by less than one
        // micro-dollar.
        const exact = amount * price.value.numerator;
        const value = mulDiv(amount, price.value, "up");
        expect(value * price.value.denominator >= exact).toBe(true);
        expect((value - 1n) * price.value.denominator < exact).toBe(true);
      }),
    );
  });

  it("refuses a rate within its bounds that sits further below its feed than the gap", async () => {
    await fc.assert(
      fc.asyncProperty(cases, fc.integer({ min: 0, max: 5_000 }), async (item, more) => {
        const { rate } = agreeing(item);
        const keptBps = BigInt(10_000 - item.maxGapBps - 1 - more);
        const feedAnswer = (feedOf(item, rate) * 10_000n) / keptBps + 1n;
        const { price } = await priceOf(item, { rate, feedAnswer, feedAgeSeconds: 0n });
        expect(price).toStrictEqual(err("price_refused"));
      }),
    );
  });

  it("refuses an agreeing rate once its feed is older than its heartbeat and 30 s", async () => {
    await fc.assert(
      fc.asyncProperty(cases, fc.bigInt({ min: 1n, max: 10n ** 9n }), async (item, past) => {
        const feedAgeSeconds = BigInt(heartbeatSeconds + 30) + past;
        const { price } = await priceOf(item, { ...agreeing(item), feedAgeSeconds });
        expect(price).toStrictEqual(err("price_refused"));
      }),
    );
  });

  it("never prices a rate under its bounds, even one its feed states", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        const rate = rateUnder(item);
        const chain = { rate, feedAnswer: feedOf(item, rate), feedAgeSeconds: 0n };
        await expect(priceOf(item, chain)).resolves.toMatchObject({ price: err("price_refused") });
      }),
    );
  });

  it("never prices a rate over its bounds, even one its feed states", async () => {
    await fc.assert(
      fc.asyncProperty(cases, fc.bigInt({ min: 1n, max: 10n ** 20n }), async (item, by) => {
        const rate = boundsOf(item).most + by;
        const chain = { rate, feedAnswer: feedOf(item, rate), feedAgeSeconds: 0n };
        await expect(priceOf(item, chain)).resolves.toMatchObject({ price: err("price_refused") });
      }),
    );
  });
});
