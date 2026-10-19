import {
  type AccountRef,
  assetRefSchema,
  isTxHash,
  type LaunchesFound,
  type LaunchLogsRequest,
  type LaunchReader,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  pad,
  parseAbi,
  toEventSelector,
  toHex,
} from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeLog } from "../decoding/decode-log.js";
import { erc20AssetRef, type EvmChain, evmAccountRef } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import {
  createFakeLeaderChain,
  type FakeLeaderChain,
  type FakeLog,
  type FakeTx,
} from "../testing/fake-leader-chain.js";
import { createFakeRpcHttp, readFakeRpcRequest } from "../testing/fake-rpc-http.js";
import { createBlockSource } from "../watching/block-source.js";
import type { LogWatch, WatchCursor } from "../watching/log-watch.js";
import { createLaunchWatcher, type LaunchBook } from "./launch-watcher.js";
import type { FeedLaunch, LaunchRead } from "./read-launch-span.js";

const blockTimeMs = 450;
const nodeUrl = "https://node.test";
const logsUrl = "https://logs.test";
const multicall = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
const chain: EvmChain = {
  ref: "eip155:56" as EvmChain["ref"],
  chainId: 56,
  name: "Test chain",
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  nativeSymbol: "BNB",
  nativeDecimals: 18,
};
const asNumber = z.bigint().pipe(z.coerce.number());
const addressOf = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "7")}`);
const pad0 = addressOf(1);
const stranger = addressOf(2);
const creator = addressOf(3);
const quote = addressOf(4);
const tokenOf = (n: number): Address => addressOf(0x100 + n);

// A launchpad of the test chain: its contract writes `Made` for each launch and `Moved` for each
// curve change; each launch's token answers `symbol()`.
const events = parseAbi([
  "event Made(address indexed token, address creator, address quote)",
  "event Moved(address indexed token, uint256 progress)",
]);
const tokenAbi = parseAbi(["function symbol() view returns (string)"]);
const symbolCall = encodeFunctionData({ abi: tokenAbi, functionName: "symbol" });
const madeTopic = toEventSelector(events[0]);
const movedTopic = toEventSelector(events[1]);

function readLaunches(request: LaunchLogsRequest): LaunchesFound {
  const own = request.logs.filter(({ emitter }) => emitter === request.contracts["pad"]);
  const launches = own.flatMap((log) => {
    const made = decodeLog(events, log);
    return made?.eventName === "Made"
      ? [
          {
            token: erc20AssetRef(chain, made.args.token),
            creator: evmAccountRef(chain, made.args.creator),
            quoteAsset: erc20AssetRef(chain, made.args.quote),
            graduated: false,
            insiders: [evmAccountRef(chain, made.args.creator)],
            index: log.index,
            complete: {
              calls: [{ target: evmAccountRef(chain, made.args.token), input: symbolCall }],
              facts: ([answer]: readonly (string | undefined)[]) =>
                answer === undefined ? {} : { symbol: "LAUNCHED" },
            },
          },
        ]
      : [];
  });
  const changes = own.flatMap((log) => {
    const moved = decodeLog(events, log);
    return moved?.eventName === "Moved"
      ? [
          {
            token: erc20AssetRef(chain, moved.args.token),
            curveProgressBps: bpsSchema.parse(asNumber.parse(moved.args.progress)),
            index: log.index,
          },
        ]
      : [];
  });
  return { launches, changes };
}

const launchpad: LaunchReader = { launchEvents: [madeTopic, movedTopic], readLaunches };

// A launchpad that names, for one launch log, a token of another chain, a launch at no log, one
// with a long name and no completing read, and one whose read is no hex.
function oddLaunches(request: LaunchLogsRequest): LaunchesFound {
  const [log] = request.logs;
  if (log === undefined) {
    return { launches: [], changes: [] };
  }
  const base = {
    creator: evmAccountRef(chain, creator),
    quoteAsset: chain.nativeAsset,
    graduated: false,
    insiders: [],
    index: log.index,
  };
  const elsewhere = assetRefSchema.parse(`eip155:1/erc20:${tokenOf(2)}`);
  const unread = {
    calls: [{ target: evmAccountRef(chain, tokenOf(4)), input: "zz" }],
    facts: () => ({}),
  };
  return {
    launches: [
      { ...base, token: elsewhere },
      { ...base, token: tokenRef(2), index: 999 },
      { ...base, token: tokenRef(3), name: "N".repeat(300) },
      { ...base, token: tokenRef(4), complete: unread },
    ],
    changes: [],
  };
}
const padAccount: AccountRef = evmAccountRef(chain, pad0);

function madeLog(token: Address, by: Address = pad0): FakeLog {
  const data = encodeAbiParameters([{ type: "address" }, { type: "address" }], [creator, quote]);
  return { address: by, topics: [madeTopic, pad(token).toLowerCase() as Hex], data };
}

const launchTx = (...tokens: readonly number[]): FakeTx => ({
  from: creator,
  to: pad0,
  logs: tokens.map((n) => madeLog(tokenOf(n))),
});

/** A book in memory: every read, and the launches by token as a store keeps them. */
interface MemoryBook extends LaunchBook {
  readonly reads: LaunchRead[];
  readonly launches: Map<string, FeedLaunch>;
  stored?: WatchCursor;
}

function memoryBook(): MemoryBook {
  const book: MemoryBook = {
    reads: [],
    launches: new Map(),
    cursor: async () => Promise.resolve(book.stored),
    async record(read) {
      book.reads.push(read);
      for (const launch of read.launches) {
        book.launches.set(launch.token, launch);
      }
      book.stored = { block: read.to, hash: read.toHash };
      return Promise.resolve();
    },
  };
  return book;
}

interface Feed {
  readonly clock: ManualClock;
  readonly fake: FakeLeaderChain;
  readonly book: MemoryBook;
  readonly watcher: LogWatch;
  readonly failures: string[];
  readonly methods: (url: string) => readonly string[];
  stop(): void;
}

const running: (() => void)[] = [];
afterEach(() => {
  running.splice(0).forEach((stop) => stop());
});

/** What a feed reads besides the test launchpad: another reader, and a call timeout. */
interface FeedExtras {
  readonly reader?: LaunchReader;
  readonly callTimeoutMs?: number;
}

/** The chain, book and clock a feed runs on. */
interface FeedParts {
  readonly fake: FakeLeaderChain;
  readonly book: MemoryBook;
  readonly clock: ManualClock;
}

function feedOn(parts: FeedParts, extras: FeedExtras = {}): Feed {
  const { fake, book, clock } = parts;
  const http = createFakeRpcHttp({ [nodeUrl]: fake.endpoint, [logsUrl]: fake.endpoint });
  const endpoint = (url: string) =>
    createRpcFailover({
      endpoints: [{ name: url, url }],
      http,
      clock,
      timeoutMs: 1_000,
      restMs: 1,
    });
  const rpc = endpoint(nodeUrl);
  const failures: string[] = [];
  const watcher = createLaunchWatcher({
    chain,
    rpc,
    logsRpc: endpoint(logsUrl),
    blocks: createBlockSource({ rpc, clock, blockTimeMs }),
    clock,
    multicall,
    blockTimeMs,
    launchpads: [
      { id: "test-pad", reader: extras.reader ?? launchpad, contracts: { pad: padAccount } },
    ],
    book,
    onReadFailed: (code) => failures.push(code),
    ...(extras.callTimeoutMs === undefined ? {} : { callTimeoutMs: extras.callTimeoutMs }),
  });
  const controller = new AbortController();
  watcher.run(controller.signal).catch(() => undefined);
  const stop = (): void => controller.abort();
  running.push(stop);
  const methods = (url: string) =>
    http
      .requests()
      .filter((request) => request.url === url)
      .map((request) => readFakeRpcRequest(request.body).method);
  return { clock, fake, book, watcher, failures, methods, stop };
}

// A launch's token answers its symbol; any other read reverts.
const reads = (target: Address, callData: Hex): Hex | undefined =>
  callData === symbolCall && target !== tokenOf(99)
    ? encodeFunctionResult({ abi: tokenAbi, functionName: "symbol", result: "LAUNCHED" })
    : undefined;

function newFeed(maxLogs?: number, extras: FeedExtras = {}): Feed {
  // The fake chain reads block numbers in whole bytes of hex: 0x1000 on.
  const fake = createFakeLeaderChain({
    start: 4_096n,
    multicall,
    reads,
    ...(maxLogs === undefined ? {} : { maxLogs }),
  });
  return feedOn({ fake, book: memoryBook(), clock: createManualClock(1_000_000) }, extras);
}

// Lets the feed poll and read until it read the chain's head.
async function caughtUp(feed: Feed, turns = 100): Promise<void> {
  if (feed.book.stored?.hash === feed.fake.hashOf(feed.fake.head())) {
    return;
  }
  if (turns === 0) {
    throw new Error(
      `The feed stopped at ${String(feed.book.stored?.block)}: ${feed.failures.join()}`,
    );
  }
  await feed.clock.advance(blockTimeMs);
  await caughtUp(feed, turns - 1);
}

const toldTokens = (feed: Feed): readonly string[] =>
  feed.book.reads.flatMap(({ launches }) => launches.map(({ token }) => token));

const tokenRef = (n: number) => erc20AssetRef(chain, tokenOf(n));

// A launch in every fourth block, from the first.
const everyFourth = (n: number): readonly FakeTx[] => (n % 4 === 0 ? [launchTx(10 + n)] : []);

// The last read that covered a block.
const lastReadOf = (feed: Feed, block: bigint): LaunchRead | undefined =>
  feed.book.reads.findLast(({ from, to }) => from <= block && block <= to);

// The launch the book holds of token `n`.
function toldLaunch(feed: Feed, n: number): FeedLaunch {
  const launch = feed.book.launches.get(tokenRef(n));
  if (launch === undefined) {
    throw new Error(`The book holds no launch of token ${String(n)}.`);
  }
  return launch;
}

// Every read starts at the block after the one before it ended.
function readsFollowOn(feed: Feed): void {
  const starts = feed.book.reads.slice(1).map(({ from }) => from);
  expect(starts).toStrictEqual(feed.book.reads.slice(0, -1).map(({ to }) => to + 1n));
}

describe("launch watcher", () => {
  it("records each launch of the launchpad's own contract once, in block order, with its block, time and completed facts", async () => {
    const feed = newFeed();
    await caughtUp(feed);
    const forged = { from: stranger, to: stranger, logs: [madeLog(tokenOf(9), stranger)] };
    const first = feed.fake.mine([launchTx(1, 2), forged]);
    const second = feed.fake.mine([launchTx(3)]);
    await caughtUp(feed);
    expect(toldTokens(feed)).toStrictEqual([tokenRef(1), tokenRef(2), tokenRef(3)]);
    const { txHash, ...told } = toldLaunch(feed, 1);
    expect(isTxHash(txHash)).toBe(true);
    expect(told).toStrictEqual({
      launchpad: "test-pad",
      token: tokenRef(1),
      creator: evmAccountRef(chain, creator),
      quoteAsset: erc20AssetRef(chain, quote),
      symbol: "LAUNCHED",
      graduated: false,
      insiders: [evmAccountRef(chain, creator)],
      block: first,
      blockHash: feed.fake.hashOf(first),
      logIndex: 0,
      launchedAtMs: asNumber.parse((1_800_000_000n + first) * 1_000n),
    });
    expect(toldLaunch(feed, 3).block).toBe(second);
    readsFollowOn(feed);
  });

  it("asks one log query a read through the log endpoint, for every declared event of any contract", async () => {
    const feed = newFeed();
    await caughtUp(feed);
    feed.fake.mine([launchTx(1)]);
    feed.fake.mine();
    await caughtUp(feed);
    expect(feed.methods(logsUrl)).toStrictEqual(feed.book.reads.map(() => "eth_getLogs"));
    expect(feed.methods(nodeUrl)).not.toContain("eth_getLogs");
  });

  it("resumes after an outage from the block after its last, with no gap and no double", async () => {
    const feed = newFeed();
    await caughtUp(feed);
    feed.fake.goDown();
    const mined = Array.from({ length: 23 }, (_each, n) => feed.fake.mine(everyFourth(n)));
    const before = feed.book.stored;
    await feed.clock.advance(blockTimeMs * 5);
    expect(feed.book.stored).toStrictEqual(before);
    feed.fake.comeBack();
    await caughtUp(feed);
    const launched = mined.filter((_block, n) => n % 4 === 0);
    expect(
      feed.book.reads.flatMap(({ launches }) => launches.map(({ block }) => block)),
    ).toStrictEqual(launched);
    readsFollowOn(feed);
    expect(feed.watcher.state()).toStrictEqual({ head: feed.fake.head(), read: feed.fake.head() });
  });

  it("starts again after a restart from its stored cursor, and from the last final block once that block was replaced", async () => {
    const feed = newFeed();
    await caughtUp(feed);
    feed.stop();
    const missed = feed.fake.mine([launchTx(1)]);
    feed.fake.mine();
    const again = feedOn(feed);
    await caughtUp(again);
    expect(toldTokens(again)).toStrictEqual([tokenRef(1)]);
    again.stop();
    feed.fake.reorg(missed);
    const moved = feed.fake.mine([launchTx(2)]);
    feed.fake.mine();
    const third = feedOn(feed);
    await caughtUp(third);
    expect(moved).toBe(missed);
    const last = lastReadOf(third, moved);
    expect(last?.launches.map(({ token }) => token)).toStrictEqual([tokenRef(2)]);
    expect(last?.from).toBeLessThanOrEqual(missed);
  });

  it("asks again over half the blocks when an endpoint refuses a catch-up as too large", async () => {
    const feed = newFeed(2);
    await caughtUp(feed);
    feed.fake.goDown();
    const mined = [feed.fake.mine([launchTx(1)]), feed.fake.mine([launchTx(2)])];
    feed.fake.mine([launchTx(3)]);
    feed.fake.comeBack();
    await caughtUp(feed);
    expect(toldTokens(feed)).toStrictEqual([tokenRef(1), tokenRef(2), tokenRef(3)]);
    expect(feed.methods(logsUrl).length).toBeGreaterThan(feed.book.reads.length);
    expect(mined).toHaveLength(2);
  });

  it("reads a span again when a launch's block answers no header, and keeps failing a block refused even alone", async () => {
    const feed = newFeed();
    await caughtUp(feed);
    feed.fake.goDown();
    feed.fake.mine();
    const launched = feed.fake.mine([launchTx(1)]);
    feed.fake.mine();
    feed.fake.answerOnce("eth_getBlockByNumber", { result: null }, toHex(launched));
    feed.fake.comeBack();
    await caughtUp(feed);
    expect(feed.failures).toStrictEqual(["chain.block_missing"]);
    expect(toldLaunch(feed, 1).block).toBe(launched);
    const refusing = newFeed(0);
    await caughtUp(refusing);
    const refused = refusing.fake.mine([launchTx(2)]);
    await refusing.clock.advance(blockTimeMs * 3);
    expect(refusing.failures).toContain("chain.rpc_error");
    expect(refusing.book.stored?.block).toBe(refused - 1n);
  });

  it("passes over a launch a launchpad names off its chain or at no log, and keeps a launch's words short", async () => {
    const odd: LaunchReader = { launchEvents: [madeTopic], readLaunches: oddLaunches };
    const feed = newFeed(undefined, { reader: odd, callTimeoutMs: 300 });
    await caughtUp(feed);
    feed.fake.mine([launchTx(1)]);
    await caughtUp(feed);
    expect(toldTokens(feed)).toStrictEqual([tokenRef(3), tokenRef(4)]);
    expect(toldLaunch(feed, 3).name).toBe("N".repeat(200));
    expect(toldLaunch(feed, 4).symbol).toBeUndefined();
  });

  it("completes at most 50 launches a read, keeps a fact whose read reverted out, and hands on curve changes", async () => {
    const feed = newFeed();
    await caughtUp(feed);
    const many = Array.from({ length: 52 }, (_each, n) => 200 + n);
    const moved = encodeAbiParameters([{ type: "uint256" }], [2_500n]);
    const move = {
      address: pad0,
      topics: [movedTopic, pad(tokenOf(5)).toLowerCase() as Hex],
      data: moved,
    };
    feed.fake.mine([launchTx(99), launchTx(...many), { from: creator, to: pad0, logs: [move] }]);
    await caughtUp(feed);
    const launches = feed.book.reads.flatMap((read) => read.launches);
    expect(launches).toHaveLength(53);
    expect(launches.filter(({ symbol }) => symbol === "LAUNCHED")).toHaveLength(49);
    expect(launches[0]?.symbol).toBeUndefined();
    expect(feed.book.reads.flatMap(({ changes }) => changes)).toStrictEqual([
      { token: tokenRef(5), curveProgressBps: 2_500, index: 53 },
    ]);
  });

  it("reads nothing without a launchpad", async () => {
    const fake = createFakeLeaderChain({ start: 4_096n, multicall });
    const book = memoryBook();
    const clock = createManualClock(1_000_000);
    const http = createFakeRpcHttp({ [nodeUrl]: fake.endpoint });
    const rpc = createRpcFailover({
      endpoints: [{ name: "n", url: nodeUrl }],
      http,
      clock,
      timeoutMs: 1_000,
      restMs: 1,
    });
    const watcher = createLaunchWatcher({
      chain,
      rpc,
      blocks: createBlockSource({ rpc, clock, blockTimeMs }),
      clock,
      multicall,
      blockTimeMs,
      launchpads: [],
      book,
    });
    const controller = new AbortController();
    running.push(() => controller.abort());
    watcher.run(controller.signal).catch(() => undefined);
    fake.mine([launchTx(1)]);
    await clock.advance(blockTimeMs * 4);
    expect(book.reads).toStrictEqual([]);
    expect(http.requests().map(({ body }) => readFakeRpcRequest(body).method)).not.toContain(
      "eth_getLogs",
    );
  });
});
