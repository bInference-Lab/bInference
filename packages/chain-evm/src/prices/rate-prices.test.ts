import assert from "node:assert/strict";
import { type AssetRef, assetRefSchema, type PriceSource, type UsdPrice } from "@binference/chain";
import { priceSourceContract } from "@binference/chain/testing";
import { err, mulDiv, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  multicall3Abi,
  pad,
  parseAbiParameters,
  toFunctionSelector,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { createFakeEvmNode, type FakeReadAnswer } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp, type FakeEndpoint } from "../testing/fake-rpc-http.js";
import { latestRoundDataCall } from "./feed-round.schema.js";
import type { RateAsset } from "./rate-assets.js";
import { createRatePrices } from "./rate-prices.js";

const url = "https://node.invalid/";
const multicall = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
const converter = getAddress("0x1adB950d8bB3dA4bE104211D5AB038628e477fE6");
const rateFeed = getAddress("0xea93C82fa07773ed645d8A79eE27041eb867f221");
const coin = assetRefSchema.parse("eip155:56/slip44:714");
const staked = assetRefSchema.parse("eip155:56/erc20:0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B");
const other = assetRefSchema.parse("eip155:56/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82");
const whole = 10n ** 18n;
const head = 131_229_177n;
const timeoutMs = 3_000;
const nowSeconds = 1_800_000_000n;
const nowMs = 1_800_000_000_000;

// `convertSnBnbToBnb(1e18)` on Lista's stake manager at block 131,229,177 (2026-11-02), which
// Chainlink's slisBNB / BNB feed also answered.
const recordedRate = 1_039_342_452_779_596_239n;
// $766.35431 a BNB, in micro-dollars per wei.
const coinPrice: UsdPrice = { numerator: 76_635_431_000n * 1_000_000n, denominator: 10n ** 26n };

const word = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);
const roundOf = (answer: bigint, updatedAtSeconds: bigint): Hex =>
  encodeAbiParameters(parseAbiParameters("uint80, int256, uint256, uint256, uint80"), [
    1n,
    answer,
    updatedAtSeconds,
    updatedAtSeconds,
    1n,
  ]);
const pausedCall = toFunctionSelector("function paused()");
const blockTimeCall = encodeFunctionData({
  abi: multicall3Abi,
  functionName: "getCurrentBlockTimestamp",
});
const convertCall = concatHex([
  toFunctionSelector("function convertSnBnbToBnb(uint256)"),
  word(whole),
]);

const asset: RateAsset = {
  asset: staked,
  coin,
  unit: whole,
  coinUnit: whole,
  converter,
  convertCall,
  minRateBps: 10_000,
  maxRateBps: 12_000,
  checkFeed: { address: rateFeed, feedUnit: whole, heartbeatSeconds: 86_400, maxGapBps: 100 },
};

interface Answers {
  readonly blockTime?: Hex | undefined;
  readonly paused?: Hex | undefined;
  readonly rate?: Hex | undefined;
  readonly round?: Hex | undefined;
}

// A block 2 s old where the stake manager is not paused and answers the recorded rate, and its
// feed answered the same rate an hour ago; `answers` replaces any of them.
function chainAnswer(answers: Answers = {}): FakeReadAnswer {
  const at = (key: keyof Answers, fallback: Hex) => (key in answers ? answers[key] : fallback);
  const byCall = new Map<string, Hex | undefined>([
    [`${multicall}${blockTimeCall}`, at("blockTime", word(nowSeconds - 2n))],
    [`${converter}${pausedCall}`, at("paused", word(0n))],
    [`${converter}${convertCall}`, at("rate", word(recordedRate))],
    [`${rateFeed}${latestRoundDataCall}`, at("round", roundOf(recordedRate, nowSeconds - 3_600n))],
  ]);
  return ({ target, callData }) => byCall.get(`${target}${callData}`);
}

// The coin's price from a feed while `isPriced`, and no other asset's; `asked` holds each ask.
function coinSource(options: { readonly isPriced: boolean }) {
  const asked: AssetRef[] = [];
  const source: PriceSource = {
    async usdPrice(item, { signal }) {
      signal.throwIfAborted();
      asked.push(item);
      return item === coin && options.isPriced ? ok(coinPrice) : err("no_price");
    },
  };
  return { source, asked };
}

interface Setup {
  readonly endpoint?: FakeEndpoint;
  readonly rpc?: RpcFailover;
  readonly isCoinPriced?: boolean;
}

function setup(options: Setup = {}) {
  const node = createFakeEvmNode({ multicall, head, answer: chainAnswer() });
  const clock = createManualClock(nowMs);
  const http = createFakeRpcHttp({ [url]: options.endpoint ?? node.endpoint });
  const failover = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http,
    clock,
    timeoutMs: 5_000,
    restMs: 1_000,
  });
  const coins = coinSource({ isPriced: options.isCoinPriced ?? true });
  const rpc = options.rpc ?? failover;
  const parts = { rpc, multicall, clock, timeoutMs, prices: coins.source };
  const prices = createRatePrices({ ...parts, assets: [asset] });
  return { prices, parts, node, http, clock, asked: coins.asked };
}

function withAnswers(answers: Answers) {
  const node = createFakeEvmNode({ multicall, head, answer: chainAnswer(answers) });
  return { ...setup({ endpoint: node.endpoint }), node };
}

const live = { signal: new AbortController().signal };
const refused = err("price_refused");
const priceOf = (rate: bigint) =>
  ok({ numerator: coinPrice.numerator * rate, denominator: coinPrice.denominator * whole });

describe("the rate price source", () => {
  it.each(
    priceSourceContract({
      create: () => ({ source: setup().prices, known: staked, unknown: other }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices the token at the coin's price times the rate, read at the head block", async () => {
    const { prices, node } = setup();
    const price = await prices.usdPrice(staked, live);
    expect(price).toStrictEqual(priceOf(recordedRate));
    expect(node.batches()).toStrictEqual([{ block: head, calls: 4 }]);
    // One slisBNB is 1.0393 BNB at $766.35431 a BNB, rounded down to the micro-dollar.
    assert.ok(price.ok);
    expect(mulDiv(whole, price.value, "down")).toBe(796_504_568n);
  });

  it("hands every other asset to the prices under it and reads no rate", async () => {
    const { prices, node, asked } = setup();
    await expect(prices.usdPrice(coin, live)).resolves.toStrictEqual(ok(coinPrice));
    await expect(prices.usdPrice(other, live)).resolves.toStrictEqual(err("no_price"));
    expect(asked).toStrictEqual([coin, other]);
    expect(node.batches()).toStrictEqual([]);
  });

  it("refuses a price while the coin has none, and asks no node then", async () => {
    const { prices, http } = setup({ isCoinPriced: false });
    await expect(prices.usdPrice(staked, live)).resolves.toStrictEqual(refused);
    expect(http.requests()).toHaveLength(0);
  });

  it.each<[string, Answers]>([
    ["the manager is paused", { paused: word(1n) }],
    ["its pause cannot be read", { paused: undefined }],
    ["its pause answers no boolean", { paused: word(2n) }],
    ["the rate reverts", { rate: undefined }],
    ["the rate is zero", { rate: word(0n), round: roundOf(0n, nowSeconds) }],
    ["the rate is one wei under one coin", { rate: word(whole - 1n) }],
    ["the rate is one wei over 1.2 coins", { rate: word((whole * 12n) / 10n + 1n) }],
    ["the rate's answer is not one word", { rate: pad(toHex(recordedRate), { size: 31 }) }],
    ["the block is 31 s old", { blockTime: word(nowSeconds - 31n) }],
    ["the block's time cannot be read", { blockTime: undefined }],
    ["the feed reverts", { round: undefined }],
    ["the feed answers outside its shape", { round: word(recordedRate) }],
    ["the feed answers zero", { round: roundOf(0n, nowSeconds) }],
    [
      "the feed is older than a day and 30 s",
      { round: roundOf(recordedRate, nowSeconds - 86_431n) },
    ],
    ["one coin, in bounds, is 3.8% under the feed", { rate: word(whole) }],
  ])("refuses a price when %s, never a guess", async (_, answers) => {
    await expect(withAnswers(answers).prices.usdPrice(staked, live)).resolves.toStrictEqual(
      refused,
    );
  });

  it.each<[string, bigint]>([
    ["exactly one coin", whole],
    ["exactly 1.2 coins", (whole * 12n) / 10n],
  ])("prices a rate of %s, at its bound, that its feed agrees with", async (_, rate) => {
    const answers = { rate: word(rate), round: roundOf(rate, nowSeconds - 86_430n) };
    await expect(withAnswers(answers).prices.usdPrice(staked, live)).resolves.toStrictEqual(
      priceOf(rate),
    );
  });

  it("prices a rate exactly 1% from its feed, and refuses one a wei further", async () => {
    const atGap = recordedRate + recordedRate / 100n;
    const round = roundOf(recordedRate, nowSeconds);
    await expect(
      withAnswers({ rate: word(atGap), round }).prices.usdPrice(staked, live),
    ).resolves.toStrictEqual(priceOf(atGap));
    await expect(
      withAnswers({ rate: word(atGap + 1n), round }).prices.usdPrice(staked, live),
    ).resolves.toStrictEqual(refused);
  });

  it.each<[string, FakeEndpoint]>([
    ["no endpoint answers", "refuse"],
    ["the whole read fails", createFakeEvmNode({ multicall, head, answer: () => "burn" }).endpoint],
  ])("refuses a price when %s", async (_, endpoint) => {
    await expect(setup({ endpoint }).prices.usdPrice(staked, live)).resolves.toStrictEqual(refused);
  });

  it("refuses a price when the read throws a fault of no known kind", async () => {
    const rpc: RpcFailover = {
      request: async () => {
        throw new TypeError("not a function");
      },
      health: () => [],
    };
    await expect(setup({ rpc }).prices.usdPrice(staked, live)).resolves.toStrictEqual(refused);
  });

  it("refuses a price once the read runs past its time limit", async () => {
    const { prices, clock } = setup({ endpoint: "hang" });
    const price = prices.usdPrice(staked, live);
    await clock.advance(timeoutMs);
    await expect(price).resolves.toStrictEqual(refused);
  });

  it("rejects with the signal's reason when it aborts during the read", async () => {
    const { prices } = setup({ endpoint: "hang" });
    const controller = new AbortController();
    const price = prices.usdPrice(staked, { signal: controller.signal });
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(price).rejects.toBe(reason);
  });

  it("reads a rate once for 3 s, then again", async () => {
    const { prices, node, clock } = setup();
    await prices.usdPrice(staked, live);
    await clock.advance(2_999);
    await expect(prices.usdPrice(staked, live)).resolves.toStrictEqual(priceOf(recordedRate));
    expect(node.batches()).toHaveLength(1);
    await clock.advance(1);
    await prices.usdPrice(staked, live);
    expect(node.batches()).toHaveLength(2);
  });

  it("keeps no refused read, so the next ask reads again", async () => {
    const { prices, node } = withAnswers({ paused: word(1n) });
    await prices.usdPrice(staked, live);
    await prices.usdPrice(staked, live);
    expect(node.batches()).toHaveLength(2);
  });

  it("refuses two rates for one asset", () => {
    const { parts } = setup();
    expect(() => createRatePrices({ ...parts, assets: [asset, asset] })).toThrow(
      expect.objectContaining({ code: "chain.bad_price_feeds" }),
    );
  });
});
