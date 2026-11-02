import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { priceSourceContract } from "@binference/chain/testing";
import { bsc } from "@binference/chains";
import type { Bps, Http } from "@binference/core";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { createPolicyCheck, type PolicyFacts, type PolicySubject } from "@binference/engine";
import { createFakePriceSource } from "@binference/engine/testing";
import {
  encodeAbiParameters,
  encodeFunctionResult,
  getAddress,
  multicall3Abi,
  parseAbiParameters,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { composePrices, priceRouterOf } from "./chain-prices.js";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains, selfHostedFeeds, selfHostedRatePrices } from "./open-engine-parts.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const elsewhere = assetRefSchema.parse("fake:2/slip44:1");
const fake = chainRefSchema.parse("fake:1");
const bscRef = chainRefSchema.parse(bsc.id);
const signal = new AbortController().signal;

function router() {
  const price = { numerator: 600n, denominator: 10n ** 12n };
  return priceRouterOf(new Map([[fake, createFakePriceSource(new Map([[coin, price]]))]]));
}

describe("the self-hosted prices", () => {
  it.each(
    priceSourceContract({ create: () => ({ source: router(), known: coin, unknown: elsewhere }) }),
  )("routes each asset to its chain's source: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices nothing of a chain it has no source for, and refuses an aborted signal", async () => {
    await expect(router().usdPrice(elsewhere, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_price",
    });
    const reason = new Error("stopped");
    await expect(router().usdPrice(coin, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });

  it("reads BSC's coin from its feed over the chain's RPC, and asks nothing for another token", async () => {
    const nowSec = 1_800_000_000n;
    // latestRoundData: round 1 answered $600.00000000 at `nowSec`.
    const round = encodeAbiParameters(
      parseAbiParameters("uint80, int256, uint256, uint256, uint80"),
      [1n, 60_000_000_000n, nowSec, nowSec, 1n],
    );
    const answer = { jsonrpc: "2.0", id: 1, result: round };
    const response = { status: 200, headers: {}, body: JSON.stringify(answer) };
    const url = "https://node.example.org/";
    const http = createScriptedHttp([{ method: "POST", url, response }]);
    const config = {
      enabled: [bscRef],
      rpc: { [bscRef]: { urls: [url] } },
      relays: {},
      maxFeePerGasGwei: { [bscRef]: "1" },
    };
    const clock = createManualClock(Number(nowSec) * 1_000);
    const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
    const prices = composePrices(reads, {
      feeds: selfHostedFeeds(),
      rates: selfHostedRatePrices(),
      clock,
    });
    const bnb = assetRefSchema.parse(`${bsc.id}/slip44:714`);
    await expect(prices.usdPrice(bnb, { signal })).resolves.toStrictEqual({
      ok: true,
      value: { numerator: 60_000_000_000n * 1_000_000n, denominator: 10n ** 8n * 10n ** 18n },
    });
    const cake = assetRefSchema.parse(`${bsc.id}/erc20:0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82`);
    await expect(prices.usdPrice(cake, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "no_price",
    });
    expect(http.requests()).toHaveLength(1);
  });
});

const nowSec = 1_800_000_000n;
// latestRoundData of BSC's BNB/USD feed: $600.00000000 at `nowSec`.
const bnbRound = encodeAbiParameters(
  parseAbiParameters("uint80, int256, uint256, uint256, uint80"),
  [1n, 60_000_000_000n, nowSec, nowSec, 1n],
);
// Lista's stake manager converted one slisBNB to this much BNB at block 131,229,177.
const listaRate = 1_039_342_452_779_596_239n;
const bnbFeed = getAddress("0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE");
const slisBnb = assetRefSchema.parse(`${bsc.id}/erc20:0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B`);
const bnbCoin = assetRefSchema.parse(`${bsc.id}/slip44:714`);
const oneSlisBnb = 10n ** 18n;

interface RpcRequest {
  readonly id: number;
  readonly method: string;
  readonly params: readonly [{ readonly to: string }];
}

const word = (value: bigint) => encodeAbiParameters([{ type: "uint256" }], [value]);

// A BSC node with the BNB feed's round, and the block's time, the stake manager's pause and rate
// and Chainlink's slisBNB / BNB round an hour old read in one Multicall3 call at its head, block 16.
function bscNode(options: { readonly isPaused: boolean }): Http {
  const rateRound = encodeAbiParameters(
    parseAbiParameters("uint80, int256, uint256, uint256, uint80"),
    [1n, listaRate, nowSec - 3_600n, nowSec - 3_600n, 1n],
  );
  const managerReads = encodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    result: [
      { success: true, returnData: word(nowSec) },
      { success: true, returnData: word(options.isPaused ? 1n : 0n) },
      { success: true, returnData: word(listaRate) },
      { success: true, returnData: rateRound },
    ],
  });
  const answers = new Map([
    ["eth_blockNumber", toHex(16n)],
    [bnbFeed, bnbRound],
  ]);
  return {
    async request(request) {
      const { id, method, params } = JSON.parse(request.body ?? "") as RpcRequest;
      const to = method === "eth_call" ? getAddress(params[0].to) : method;
      const result = answers.get(to) ?? managerReads;
      const body = JSON.stringify({ jsonrpc: "2.0", id, result });
      return { status: 200, headers: {}, body };
    },
  };
}

function bscPrices(options: { readonly isPaused: boolean }) {
  const url = "https://node.example.org/";
  const config = {
    enabled: [bscRef],
    rpc: { [bscRef]: { urls: [url] } },
    relays: {},
    maxFeePerGasGwei: { [bscRef]: "1" },
  };
  const clock = createManualClock(Number(nowSec) * 1_000);
  const http = bscNode(options);
  const reads = composeChainReads({ chains: selfHostedChains(), config, http, clock });
  const prices = composePrices(reads, {
    feeds: selfHostedFeeds(),
    rates: selfHostedRatePrices(),
    clock,
  });
  return { prices, clock };
}

// A quote that pays 1 BNB, $600, for the 2 slisBNB of the sale below.
const cheapQuote = {
  amountIn: { asset: slisBnb, base: 2n * oneSlisBnb },
  expectedOut: { asset: bnbCoin, base: oneSlisBnb },
};

// A sale of 2 slisBNB under a $1,000 cap per trade and a $5,000 day, nothing spent yet.
const sale: PolicySubject = {
  kind: "sell",
  isPaper: false,
  hasOutsideContent: false,
  outflows: [{ asset: slisBnb, base: 2n * oneSlisBnb }],
  inflowAssets: [bnbCoin],
};
const facts: PolicyFacts = {
  isFrozen: false,
  limits: {
    perTradeCapUsdMicros: 1_000_000_000n,
    rollingDayCapUsdMicros: 5_000_000_000n,
    maxSlippageBps: { registry: 100 as Bps, other: 500 as Bps },
    gasReserveBase: 0n,
    venues: [],
    allowTokens: [],
    denyTokens: [],
  },
  sendLevel: 0,
  addressBook: [],
  nativeAsset: bnbCoin,
  nativeBalanceBase: oneSlisBnb,
  ceilingPerTxNativeBase: oneSlisBnb,
  recentOutflows: [],
};

describe("slisBNB's price from Lista's stake manager", () => {
  it("is BNB's feed price times the stake manager's rate", async () => {
    const { prices } = bscPrices({ isPaused: false });
    await expect(prices.usdPrice(slisBnb, { signal })).resolves.toStrictEqual({
      ok: true,
      value: {
        numerator: 60_000_000_000n * 1_000_000n * listaRate,
        denominator: 10n ** 8n * 10n ** 18n * oneSlisBnb,
      },
    });
  });

  it("values a slisBNB sale for the caps at it, rounded up, even beside a quote", async () => {
    const { prices, clock } = bscPrices({ isPaused: false });
    const policy = createPolicyCheck({ prices, clock });
    // 2 x $600 x 1.039342452779596239 is $1,247.2109433355..., up to the next micro-dollar.
    const figures = { valueUsdMicros: 1_247_210_944n, rollingDaySpentUsdMicros: 0n };
    const refused = { ok: false, error: "per_trade_cap", reasons: ["per_trade_cap"], figures };
    await expect(policy.check(sale, facts, { signal })).resolves.toStrictEqual(refused);
    // A quote that values the 2 slisBNB at $600 does not move the rate's price.
    const quote = cheapQuote;
    await expect(policy.check(sale, facts, { signal, quote })).resolves.toStrictEqual(refused);
  });

  it("refuses a price while the manager is paused, so the policy refuses the sale", async () => {
    const { prices, clock } = bscPrices({ isPaused: true });
    await expect(prices.usdPrice(slisBnb, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "price_refused",
    });
    const policy = createPolicyCheck({ prices, clock });
    const noPrice = { ok: false, error: "no_price", reasons: ["no_price"] };
    await expect(policy.check(sale, facts, { signal })).resolves.toStrictEqual(noPrice);
    // The quote's $600, under the cap, never stands in for the refused rate.
    const quote = cheapQuote;
    await expect(policy.check(sale, facts, { signal, quote })).resolves.toStrictEqual(noPrice);
  });
});
