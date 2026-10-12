import { type AssetRef, assetRefSchema, chainRefSchema } from "@binference/chain";
import { priceReaderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  parseAbi,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import type { EvmChain } from "../evm-chain.js";
import type { FeedAsset } from "../prices/price-from-round.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode, type FakeRead } from "../testing/fake-evm-node.js";
import { createFakeRpcHttp } from "../testing/fake-rpc-http.js";
import { createPoolPriceReader } from "./pool-price-reader.js";
import { slot0Call } from "./pool-state.js";

const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const nowMs = 1_800_000_000_000;
const chain: EvmChain = {
  ref: chainRefSchema.parse("eip155:56"),
  chainId: 56,
  name: "Test chain",
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  nativeSymbol: "BNB",
  nativeDecimals: 18,
};
const at = (byte: number): Address => getAddress(toHex(byte, { size: 20 }));
const erc20 = (address: Address): AssetRef => assetRefSchema.parse(`eip155:56/erc20:${address}`);

const token = at(0x50);
const lonely = at(0x51);
const wrapped = at(0x60);
const stable = at(0x40);
const v2Factory = at(0x70);
const v3Factory = at(0x71);
const pair = at(0x80);
const pool = at(0x81);
const wrappedFeed = at(0x90);
const stableFeed = at(0x91);
const feedOf = (address: Address, feed: Address, kind: "coin" | "stablecoin"): FeedAsset => ({
  asset: erc20(address),
  decimals: 18,
  isStablecoin: kind === "stablecoin",
  feed: { address: feed, decimals: 8, heartbeatSeconds: 60 },
});
// The wrapped coin at $600, the stablecoin at $1.
const quotes: readonly FeedAsset[] = [
  feedOf(wrapped, wrappedFeed, "coin"),
  feedOf(stable, stableFeed, "stablecoin"),
];

const abi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address)",
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function liquidity() view returns (uint128)",
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);

interface Chain {
  /** Each pool's quote balance, in base units. */
  readonly balances: ReadonlyMap<Address, bigint>;
  readonly liquidity: bigint;
}

const addressWord = (value: Address): Hex => encodeAbiParameters([{ type: "address" }], [value]);
const numberWord = (value: bigint): Hex => encodeAbiParameters([{ type: "uint256" }], [value]);
const round = (answer: bigint): Hex =>
  encodeAbiParameters(
    [
      { type: "uint80" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint80" },
    ],
    [1n, answer, 0n, BigInt(nowMs / 1_000), 1n],
  );
const balanceOf = (holder: Address): Hex =>
  encodeFunctionData({ abi, functionName: "balanceOf", args: [holder] });

// What the chain answers: the one pair and the one pool of the token against the wrapped coin, the
// balances, and both feeds. Every other read reverts.
function answerOf(state: Chain): (read: FakeRead) => Hex | undefined {
  const answers: readonly (readonly [Address, Hex, Hex])[] = [
    [
      v2Factory,
      encodeFunctionData({ abi, functionName: "getPair", args: [token, wrapped] }),
      addressWord(pair),
    ],
    [
      v3Factory,
      encodeFunctionData({ abi, functionName: "getPool", args: [token, wrapped, 500] }),
      addressWord(pool),
    ],
    [wrapped, balanceOf(pair), numberWord(state.balances.get(pair) ?? 0n)],
    [wrapped, balanceOf(pool), numberWord(state.balances.get(pool) ?? 0n)],
    [pool, encodeFunctionData({ abi, functionName: "liquidity" }), numberWord(state.liquidity)],
    [
      pair,
      encodeFunctionData({ abi, functionName: "getReserves" }),
      encodeAbiParameters(
        [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
        [1n, 1n, 0],
      ),
    ],
    [
      wrappedFeed,
      encodeFunctionData({ abi, functionName: "latestRoundData" }),
      round(600n * 10n ** 8n),
    ],
    [stableFeed, encodeFunctionData({ abi, functionName: "latestRoundData" }), round(10n ** 8n)],
  ];
  const byCall = new Map(answers.map(([target, data, answer]) => [`${target}${data}`, answer]));
  return ({ target, callData }) => byCall.get(`${target}${callData}`);
}

// The value of a read that succeeded; a test that expects one fails on any other.
function valueOf<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("The read answered no value.");
  }
  return result.value;
}

function readerOver(state: Chain, minDepthUsdMicros = 1_000_000_000n) {
  const clock = createManualClock(nowMs);
  const node = createFakeEvmNode({ multicall, head: 1n, answer: answerOf(state) });
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url: "https://node.test" }],
    http: createFakeRpcHttp({ "https://node.test": node.endpoint }),
    clock,
    timeoutMs: 1_000,
    restMs: 1,
  });
  const reader = createPoolPriceReader({
    rpc,
    chain,
    clock,
    multicall,
    v2Factory,
    v3Factory,
    v3Fees: [100, 500, 2_500, 10_000],
    quotes,
    minDepthUsdMicros,
  });
  return { reader, node };
}

// The v2 pair holds 10 of the wrapped coin, $6,000; the v3 pool 50, $30,000.
const deep: Chain = {
  balances: new Map([
    [pair, 10n * 10n ** 18n],
    [pool, 50n * 10n ** 18n],
  ]),
  liquidity: 1_000n,
};
const live = { signal: new AbortController().signal };
const slot0 = encodeAbiParameters(
  [
    { type: "uint160" },
    { type: "int24" },
    { type: "uint16" },
    { type: "uint16" },
    { type: "uint16" },
    { type: "uint32" },
    { type: "bool" },
  ],
  [2n ** 96n, 0, 0, 0, 0, 0, true],
);

describe("pool price reader", () => {
  it.each(
    priceReaderContract({
      create: () => ({
        reader: readerOver(deep).reader,
        priced: { token: erc20(token), contracts: {} },
        answers: [slot0],
        unpriced: { token: erc20(lonely), contracts: {} },
      }),
    }),
  )("follows the price reader contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads the deepest pool by the dollars of quote it holds, in two batches", async () => {
    const { reader, node } = readerOver(deep);
    const read = valueOf(await reader.priceRead({ token: erc20(token), contracts: {} }, live));
    expect(read.quoteAsset).toBe(erc20(wrapped));
    expect(read.calls).toStrictEqual([{ target: `eip155:56:${pool}`, input: slot0Call }]);
    // Two quotes, each asked for its v2 pair and four v3 pools; then two pools and one feed.
    expect(node.batches()).toStrictEqual([
      { block: "latest", calls: 10 },
      { block: "latest", calls: 5 },
    ]);
  });

  it("leaves out a v3 pool with no liquidity in range", async () => {
    const { reader } = readerOver({ ...deep, liquidity: 0n });
    const read = valueOf(await reader.priceRead({ token: erc20(token), contracts: {} }, live));
    expect(read.calls[0]?.target).toBe(`eip155:56:${pair}`);
  });

  it("refuses pools that hold less than the least depth", async () => {
    const { reader } = readerOver(deep, 30_000_000_001n);
    expect(await reader.priceRead({ token: erc20(token), contracts: {} }, live)).toStrictEqual({
      ok: false,
      error: "no_price_read",
    });
  });

  it("refuses the chain's coin and a token of another chain without a read", async () => {
    const { reader, node } = readerOver(deep);
    const other = assetRefSchema.parse(`eip155:1/erc20:${token}`);
    const reads = await Promise.all(
      [chain.nativeAsset, other].map(async (asset) =>
        reader.priceRead({ token: asset, contracts: {} }, live),
      ),
    );
    const refused = { ok: false, error: "no_price_read" };
    expect(reads).toStrictEqual([refused, refused]);
    expect(node.batches()).toStrictEqual([]);
  });
});
