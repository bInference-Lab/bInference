import { type AssetRef, accountRefSchema, assetRefSchema } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { type Address, encodeAbiParameters, getAddress, type Hex, toHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import type { FeedAsset } from "../prices/price-from-round.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { createFakeEvmNode, type FakeEvmNode, type FakeRead } from "../testing/fake-evm-node.js";
import {
  createFakeRpcHttp,
  type FakeEndpoint,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import {
  type BlockSource,
  type BlockSourceState,
  createBlockSource,
  type SeenHead,
} from "./block-source.js";
import { poolPrice, reservesCall } from "./pool-state.js";
import {
  createPriceWatcher,
  type PriceWatcher,
  type ReadQuarantine,
  type WatchedPrice,
} from "./price-watcher.js";
import type { PlanFailure, PricePlan } from "./watch-list.js";

const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const blockTimeMs = 450;
const startMs = 1_800_000_000_000;
const quoteAddress = getAddress("0x00000000000000000000000000000000000000f1");
const feedAddress = getAddress("0x00000000000000000000000000000000000000fe");
const quote = assetRefSchema.parse(`eip155:56/erc20:${quoteAddress}`);
// The quote token is worth $600, with 18 decimals, by a feed of 8 decimals.
const feed: FeedAsset = {
  asset: quote,
  decimals: 18,
  isStablecoin: false,
  feed: { address: feedAddress, decimals: 8, heartbeatSeconds: 60 },
};

const addressOf = (index: number): Address => getAddress(toHex(0x1000 + index, { size: 20 }));
const tokenOf = (index: number): AssetRef =>
  assetRefSchema.parse(`eip155:56/erc20:${addressOf(index)}`);
// Each token's pool sits at its address plus 0x100000; its quote reserve grows with the block.
const poolOf = (token: AssetRef): Address =>
  getAddress(toHex(BigInt(`0x${token.slice(-40)}`) + 0x100000n, { size: 20 }));

interface Rig {
  readonly clock: ManualClock;
  readonly node: FakeEvmNode;
  readonly watcher: PriceWatcher;
  readonly prices: WatchedPrice[];
  readonly planned: AssetRef[];
  readonly rpc: RpcFailover;
  readonly socket: ReturnType<typeof manualHeads>;
  /** Takes the node down, its batches only, or makes its pools answer nothing. */
  readonly pools: {
    isDown: boolean;
    isCallDown: boolean;
    isUnpriced: boolean;
    failingBlock?: bigint | undefined;
    /** Contracts whose reads burn their gas. */
    readonly burning: Set<Address>;
  };
  readonly quarantines: ReadQuarantine[];
}

const controllers: AbortController[] = [];

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
});

function reserves(block: bigint | "latest"): Hex {
  const quoteReserve = block === "latest" ? 1_000n : 1_000n + block;
  return encodeAbiParameters(
    [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
    [10n, quoteReserve, 0],
  );
}

function round(): Hex {
  return encodeAbiParameters(
    [
      { type: "uint80" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint80" },
    ],
    [1n, 600n * 10n ** 8n, 0n, BigInt(startMs / 1_000), 1n],
  );
}

// What the pools' plan of a token is called: its source and its pool.
const planOfToken = (index: number): string => `test-pools:${poolOf(tokenOf(index))}`;

function plan(token: AssetRef): PricePlan {
  return {
    source: "test-pools",
    read: {
      depthUsdMicros: 50_000_000_000n,
      quoteAsset: quote,
      calls: [
        { target: accountRefSchema.parse(`eip155:56:${poolOf(token)}`), input: reservesCall },
      ],
      price: (answers) => poolPrice({ kind: "v2", isToken0: true }, answers),
    },
  };
}

const unfed = assetRefSchema.parse("eip155:56/erc20:0x00000000000000000000000000000000000000f2");

// Plans that test the edges: a quote with no feed, a call no batch can carry, a pricing step that
// throws. Any other token has the pools' plan, and token 999 none.
function planOf(token: AssetRef): Result<PricePlan, PlanFailure> {
  const base = plan(token);
  const edges = new Map<AssetRef, PricePlan>([
    [tokenOf(997), { ...base, read: { ...base.read, quoteAsset: unfed } }],
    [
      tokenOf(996),
      {
        ...base,
        read: {
          ...base.read,
          calls: [{ target: base.read.calls[0]?.target ?? (quote as never), input: "pool" }],
        },
      },
    ],
    [tokenOf(994), { ...base, read: { ...base.read, price: () => err("replan") } }],
    [
      tokenOf(995),
      {
        ...base,
        read: {
          ...base.read,
          price: () => {
            throw new Error("broken");
          },
        },
      },
    ],
  ]);
  return token === tokenOf(999) ? err("no_price_read") : ok(edges.get(token) ?? base);
}

const ignoreHead = (_number: bigint, _seen?: SeenHead): void => undefined;

/** A block source a test drives, as a socket ahead of the HTTP nodes would. */
function manualHeads(
  clock: ManualClock,
): BlockSource & { announce(number: bigint, seen?: SeenHead): void } {
  let onHead: (number: bigint, seen?: SeenHead) => void = ignoreHead;
  let state: BlockSourceState = { mode: "subscription" };
  return {
    async run(listener, signal) {
      onHead = listener;
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    },
    state: () => state,
    announce(number, seen) {
      state = { mode: "subscription", head: number, headAtMs: clock.now() };
      onHead(number, seen);
    },
  };
}

function rig(options: { readonly heads?: "socket" } = {}): Rig {
  const clock = createManualClock(startMs);
  const pools: Rig["pools"] = {
    isDown: false,
    isCallDown: false,
    isUnpriced: false,
    burning: new Set(),
  };
  const answer = (read: FakeRead): Hex | undefined | "burn" => {
    if (pools.burning.has(read.target)) {
      return "burn";
    }
    if (read.target === feedAddress) {
      return round();
    }
    return pools.isUnpriced ? undefined : reserves(read.block);
  };
  const node = createFakeEvmNode({ multicall, head: 100n, answer });
  const live = node.endpoint;
  const endpoint: FakeEndpoint = (request) => {
    const { method, params } = readFakeRpcRequest(request.body);
    const isCall = method === "eth_call";
    const failing = pools.failingBlock === undefined ? "none" : toHex(pools.failingBlock);
    const isFailing = isCall && params[1] === failing;
    if (pools.isDown || (isCall && pools.isCallDown) || isFailing) {
      throw new Error("down");
    }
    return live(request);
  };
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url: "https://node.test" }],
    http: createFakeRpcHttp({ "https://node.test": endpoint }),
    clock,
    timeoutMs: 1_000,
    restMs: 1,
  });
  const planned: AssetRef[] = [];
  const planPrices = async (token: AssetRef): Promise<Result<PricePlan, PlanFailure>> => {
    planned.push(token);
    // Token 993's first plan fails as one with no RPC to read through does.
    const isFirst = planned.filter((each) => each === token).length === 1;
    if (token === tokenOf(993) && isFirst) {
      throw new BinferenceError({ code: "chain.rpc_down", message: "No node answered." });
    }
    return await Promise.resolve(planOf(token));
  };
  const socket = manualHeads(clock);
  const quarantines: ReadQuarantine[] = [];
  const blocks =
    options.heads === "socket" ? socket : createBlockSource({ rpc, clock, blockTimeMs });
  const watcher = createPriceWatcher({
    rpc,
    blocks,
    clock,
    multicall,
    blockTimeMs,
    planPrices,
    feeds: [feed],
    onQuarantine: (quarantine) => quarantines.push(quarantine),
  });
  const prices: WatchedPrice[] = [];
  watcher.onPrice((price) => prices.push(price));
  const controller = new AbortController();
  controllers.push(controller);
  watcher.run(controller.signal).catch(() => undefined);
  return { clock, node, watcher, prices, planned, pools, rpc, socket, quarantines };
}

// The blocks the node was asked to read a batch at, oldest first.
const blocksAsked = (subject: Rig): readonly (bigint | "latest")[] =>
  subject.node.batches().map(({ block }) => block);

// Moves the chain one block and lets the watcher read it.
async function nextBlock(subject: Rig, head: bigint): Promise<void> {
  subject.node.setHead(head);
  await subject.clock.advance(blockTimeMs);
}

describe("price watcher", () => {
  it("reads a watched token at each new block, in one call at that block, in its quote and USD", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.node.batches()).toStrictEqual([{ block: 101n, calls: 2 }]);
    expect(subject.prices).toStrictEqual([
      {
        token: tokenOf(1),
        block: 101n,
        atMs: startMs + blockTimeMs,
        askedAtMs: startMs + blockTimeMs,
        source: "test-pools",
        plan: planOfToken(1),
        depthUsdMicros: 50_000_000_000n,
        quoteAsset: quote,
        quotePrice: { numerator: 1_101n, denominator: 10n },
        // 110.1 quote base units a base unit, at $600 for 10^18 base units of the quote.
        usdPrice: { numerator: 3_303n, denominator: 50_000_000_000n },
      },
    ]);
    expect(subject.watcher.tokens()).toStrictEqual([
      { token: tokenOf(1), state: "priced", source: "test-pools", plan: planOfToken(1) },
    ]);
  });

  it("reads 200 watched tokens in one multicall a block", async () => {
    const subject = rig();
    Array.from({ length: 200 }, (_unused, index) => subject.watcher.watch(tokenOf(index)));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    await nextBlock(subject, 102n);
    await nextBlock(subject, 103n);
    expect(subject.node.batches()).toStrictEqual([
      { block: 101n, calls: 201 },
      { block: 102n, calls: 201 },
      { block: 103n, calls: 201 },
    ]);
    expect(subject.prices).toHaveLength(600);
  });

  it("reads a token once however many watch it, until the last watch ends", async () => {
    const subject = rig();
    const releases = [1, 1, 1, 2].map((index) => subject.watcher.watch(tokenOf(index)));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.planned).toStrictEqual([tokenOf(1), tokenOf(2)]);
    releases[0]?.();
    releases[0]?.();
    releases[1]?.();
    await nextBlock(subject, 102n);
    releases[2]?.();
    await nextBlock(subject, 103n);
    releases[3]?.();
    await nextBlock(subject, 104n);
    expect(subject.node.batches()).toStrictEqual([
      { block: 101n, calls: 3 },
      { block: 102n, calls: 3 },
      { block: 103n, calls: 2 },
    ]);
  });

  it("reads each block in order when behind, and only the newest four past that", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    await nextBlock(subject, 103n);
    await nextBlock(subject, 112n);
    expect(blocksAsked(subject)).toStrictEqual([101n, 102n, 103n, 109n, 110n, 111n, 112n]);
    expect(subject.watcher.lag()).toMatchObject({
      head: 112n,
      read: 112n,
      lagBlocks: 0n,
      skippedBlocks: 5n,
    });
  });

  it("sends a catch-up's batches together and hands their prices on in block order", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    const sentByFirstPrice: (bigint | "latest")[][] = [];
    subject.watcher.onPrice(() => {
      sentByFirstPrice.push(subject.node.batches().map(({ block }) => block));
    });
    await nextBlock(subject, 105n);
    expect(sentByFirstPrice[0]).toStrictEqual([101n, 102n, 103n, 104n, 105n]);
    expect(subject.prices.map(({ block }) => block)).toStrictEqual([101n, 102n, 103n, 104n, 105n]);
  });

  it("hands on no block after one it could not read", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    subject.pools.failingBlock = 103n;
    await nextBlock(subject, 104n);
    expect(subject.prices.map(({ block }) => block)).toStrictEqual([101n, 102n]);
    expect(subject.watcher.lag()).toMatchObject({ read: 102n, readFault: "chain.rpc_down" });
    subject.pools.failingBlock = undefined;
    await subject.clock.advance(blockTimeMs);
    expect(subject.prices.map(({ block }) => block)).toStrictEqual([101n, 102n, 103n, 104n]);
  });

  it("counts the blocks the chain should have made while no head came", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    subject.pools.isDown = true;
    await subject.clock.advance(blockTimeMs * 10);
    expect(subject.watcher.lag()).toMatchObject({ head: 101n, read: 101n, lagBlocks: 9n });
    expect(subject.watcher.lag().source).toMatchObject({ mode: "polling", fault: "rpc_down" });
  });

  it("reads a block again when its batch fails, and says why until one succeeds", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    subject.pools.isCallDown = true;
    await nextBlock(subject, 101n);
    expect(subject.watcher.lag()).toMatchObject({
      head: 101n,
      read: 100n,
      readFault: "chain.rpc_down",
    });
    subject.pools.isCallDown = false;
    await subject.clock.advance(blockTimeMs * 2);
    expect(blocksAsked(subject)).toStrictEqual([101n]);
    expect(subject.watcher.lag().readFault).toBeUndefined();
  });

  it("bounds a batch's gas at 1,000,000 a call, and at most 50,000,000", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    Array.from({ length: 99 }, (_unused, index) => subject.watcher.watch(tokenOf(index + 2)));
    await subject.clock.advance(0);
    await nextBlock(subject, 102n);
    await nextBlock(subject, 103n);
    expect(subject.node.gasLimits()).toStrictEqual([3_000_000n, 3_000_000n, 50_000_000n]);
  });

  it("reads a batch a call fails again in halves at its block, and leaves that token out", async () => {
    const subject = rig();
    [1, 2, 3, 4, 5].forEach((index) => subject.watcher.watch(tokenOf(index)));
    await subject.clock.advance(0);
    subject.pools.burning.add(poolOf(tokenOf(4)));
    await nextBlock(subject, 101n);
    expect(subject.prices.map(({ token, block }) => [token, block])).toStrictEqual(
      [1, 2, 3, 5].map((index) => [tokenOf(index), 101n]),
    );
    expect(subject.quarantines).toStrictEqual([
      { token: tokenOf(4), block: 101n, code: "chain.rpc_error" },
    ]);
    expect(subject.watcher.tokens()[3]).toStrictEqual({ token: tokenOf(4), state: "unpriced" });
    expect(subject.watcher.lag()).toMatchObject({ read: 101n });
    await nextBlock(subject, 102n);
    expect(subject.node.batches().at(-1)).toStrictEqual({ block: 102n, calls: 5 });
    subject.pools.burning.clear();
    await subject.clock.advance(30_000);
    expect(subject.planned.filter((token) => token === tokenOf(4))).toHaveLength(2);
  });

  it("fails the block when the node refuses the feeds' batch alone too", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    subject.pools.burning.add(feedAddress);
    await nextBlock(subject, 101n);
    expect(subject.prices).toStrictEqual([]);
    expect(subject.quarantines).toStrictEqual([]);
    expect(subject.watcher.lag()).toMatchObject({ read: 100n, readFault: "chain.rpc_error" });
  });

  it("keeps a plan through two blocks that price nothing, and finds another after the third", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    subject.pools.isUnpriced = true;
    await nextBlock(subject, 101n);
    await nextBlock(subject, 102n);
    expect(subject.planned).toStrictEqual([tokenOf(1)]);
    expect(subject.watcher.tokens()).toStrictEqual([{ token: tokenOf(1), state: "unpriced" }]);
    await nextBlock(subject, 103n);
    await subject.clock.advance(0);
    expect(subject.planned).toStrictEqual([tokenOf(1), tokenOf(1)]);
    subject.pools.isUnpriced = false;
    await nextBlock(subject, 104n);
    expect(subject.prices.map(({ block }) => block)).toStrictEqual([104n]);
    expect(subject.watcher.tokens()).toStrictEqual([
      { token: tokenOf(1), state: "priced", source: "test-pools", plan: planOfToken(1) },
    ]);
  });

  it("finds each token's pools again every 10 minutes, each at a time of its own, pricing meanwhile", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    subject.watcher.watch(tokenOf(2));
    await subject.clock.advance(0);
    const timesPlanned = (index: number): number =>
      subject.planned.filter((token) => token === tokenOf(index)).length;
    await subject.clock.advance(588_000);
    expect([timesPlanned(1), timesPlanned(2)]).toStrictEqual([1, 2]);
    await subject.clock.advance(12_000);
    expect([timesPlanned(1), timesPlanned(2)]).toStrictEqual([2, 2]);
    await nextBlock(subject, 101n);
    expect(subject.prices.map(({ token }) => token)).toStrictEqual([tokenOf(1), tokenOf(2)]);
  });

  it("finds another plan at once when the answers say the plan no longer holds", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(994));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.watcher.tokens()).toStrictEqual([{ token: tokenOf(994), state: "unpriced" }]);
    await subject.clock.advance(1_000);
    expect(subject.planned).toStrictEqual([tokenOf(994)]);
    await subject.clock.advance(1_000);
    expect(subject.planned).toStrictEqual([tokenOf(994), tokenOf(994)]);
  });

  it("asks again a block time later when planning failed for want of an RPC, 30 s when no reader prices it", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(993));
    subject.watcher.watch(tokenOf(999));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.planned).toStrictEqual([tokenOf(993), tokenOf(999), tokenOf(993)]);
    expect(subject.watcher.tokens()[0]).toStrictEqual({
      token: tokenOf(993),
      state: "priced",
      source: "test-pools",
      plan: planOfToken(993),
    });
    await subject.clock.advance(29_000);
    expect(subject.planned.filter((token) => token === tokenOf(999))).toHaveLength(1);
    await subject.clock.advance(1_000);
    expect(subject.planned.filter((token) => token === tokenOf(999))).toHaveLength(2);
  });

  it("prices a token in its quote alone when the quote has no feed", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(997));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.prices).toStrictEqual([
      {
        token: tokenOf(997),
        block: 101n,
        atMs: startMs + blockTimeMs,
        askedAtMs: startMs + blockTimeMs,
        source: "test-pools",
        plan: planOfToken(997),
        depthUsdMicros: 50_000_000_000n,
        quoteAsset: unfed,
        quotePrice: { numerator: 1_101n, denominator: 10n },
      },
    ]);
  });

  it("leaves out the USD price once the quote's feed is stale", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await subject.clock.advance(91_000);
    await nextBlock(subject, 101n);
    expect(subject.prices.map(({ usdPrice }) => usdPrice)).toStrictEqual([undefined]);
  });

  it("counts a plan it cannot batch, or whose pricing step throws, as unpriced", async () => {
    const subject = rig();
    subject.watcher.watch(tokenOf(996));
    subject.watcher.watch(tokenOf(995));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.prices).toStrictEqual([]);
    expect(subject.watcher.tokens()).toStrictEqual([
      { token: tokenOf(996), state: "unpriced" },
      { token: tokenOf(995), state: "unpriced" },
    ]);
  });

  it("reads a block no node has imported yet again in a moment, and rests no endpoint", async () => {
    const subject = rig({ heads: "socket" });
    subject.watcher.watch(tokenOf(1));
    subject.socket.announce(100n);
    await subject.clock.advance(0);
    subject.socket.announce(101n);
    await subject.clock.advance(0);
    expect(subject.node.batches()).toStrictEqual([]);
    subject.node.setHead(101n);
    await subject.clock.advance(150);
    expect(subject.node.batches()).toStrictEqual([{ block: 101n, calls: 2 }]);
    expect(subject.prices.map(({ block, atMs }) => [block, atMs])).toStrictEqual([
      [101n, startMs + 150],
    ]);
    expect(subject.rpc.health()).toStrictEqual([{ name: "node" }]);
    expect(subject.watcher.lag().readFault).toBeUndefined();
  });

  it("reads a block again when another block replaces it at its height", async () => {
    const subject = rig({ heads: "socket" });
    subject.watcher.watch(tokenOf(1));
    subject.socket.announce(100n);
    await subject.clock.advance(0);
    subject.node.setHead(101n);
    subject.socket.announce(101n);
    await subject.clock.advance(0);
    subject.socket.announce(101n, { isReorg: true });
    await subject.clock.advance(0);
    expect(blocksAsked(subject)).toStrictEqual([101n, 101n]);
    expect(subject.prices.map(({ block }) => block)).toStrictEqual([101n, 101n]);
  });

  it("reads nothing while it watches no token", async () => {
    const subject = rig();
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    expect(subject.node.batches()).toStrictEqual([]);
    expect(subject.watcher.lag()).toMatchObject({ head: 101n, read: 101n, lagBlocks: 0n });
  });

  it("goes on reading when a listener fails, and stops a listener on its release", async () => {
    const subject = rig();
    const seen: bigint[] = [];
    subject.watcher.onPrice(() => {
      throw new Error("listener broke");
    });
    const release = subject.watcher.onPrice((price) => seen.push(price.block));
    subject.watcher.watch(tokenOf(1));
    await subject.clock.advance(0);
    await nextBlock(subject, 101n);
    release();
    await nextBlock(subject, 102n);
    expect(seen).toStrictEqual([101n]);
    expect(subject.prices.map(({ block }) => block)).toStrictEqual([101n, 102n]);
  });

  it("ends its block source with its reads when the reads fail on a fault", async () => {
    const clock = createManualClock();
    const node = createFakeEvmNode({ multicall, head: 1n, answer: () => undefined });
    const http = createFakeRpcHttp({ "https://node.test": node.endpoint });
    const rpc = createRpcFailover({
      endpoints: [{ name: "node", url: "https://node.test" }],
      http,
      clock,
      timeoutMs: 1_000,
      restMs: 1,
    });
    const fault = new TypeError("a planner that broke");
    const watcher = createPriceWatcher({
      rpc,
      blocks: createBlockSource({ rpc, clock, blockTimeMs }),
      clock,
      multicall,
      blockTimeMs,
      planPrices: () => {
        throw fault;
      },
      feeds: [],
    });
    watcher.watch(tokenOf(1));
    const running = watcher.run(new AbortController().signal);
    await clock.advance(0);
    await expect(running).rejects.toBe(fault);
    const polls = http.requests().length;
    await clock.advance(blockTimeMs * 10);
    expect(http.requests()).toHaveLength(polls);
  });

  it("stops with the signal's reason", async () => {
    const clock = createManualClock();
    const node = createFakeEvmNode({ multicall, head: 1n, answer: () => undefined });
    const rpc = createRpcFailover({
      endpoints: [{ name: "node", url: "https://node.test" }],
      http: createFakeRpcHttp({ "https://node.test": node.endpoint }),
      clock,
      timeoutMs: 1_000,
      restMs: 1,
    });
    const watcher = createPriceWatcher({
      rpc,
      blocks: createBlockSource({ rpc, clock, blockTimeMs }),
      clock,
      multicall,
      blockTimeMs,
      planPrices: async () => await Promise.resolve(err("no_price_read")),
      feeds: [],
    });
    const controller = new AbortController();
    const running = watcher.run(controller.signal);
    const reason = new Error("stopped");
    await clock.advance(0);
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
  });
});
