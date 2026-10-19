import { type AccountRef, assetRefSchema } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { type Address, getAddress } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { erc20AssetRef, type EvmChain, evmAccountRef } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import {
  createFakeLeaderChain,
  type FakeLeaderChain,
  type FakeLeaderChainOptions,
  type FakeTx,
} from "../testing/fake-leader-chain.js";
import {
  createFakeRpcHttp,
  type FakeRpcHttp,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import { createBlockSource } from "../watching/block-source.js";
import type { WalletTrade } from "./finish-trades.js";
import {
  createLeaderWatcher,
  type LeaderBook,
  type LeaderWatcher,
  type TrackedLeader,
  type WatchCursor,
} from "./leader-watcher.js";
import type { LeaderRead } from "./read-leader-span.js";

const blockTimeMs = 450;
const url = "https://node.test";
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

function addressOf(prefix: string, n: number): Address {
  return getAddress(`0x${prefix}${n.toString(16).padStart(40 - prefix.length, "0")}`);
}

const leader = addressOf("1a", 1);
const later = addressOf("1a", 2);
const whale = addressOf("1a", 3);
const meme = addressOf("2b", 1);
const usdt = addressOf("3c", 1);
const router = addressOf("4d", 1);
const curve = addressOf("4d", 2);
const pool = addressOf("5e", 1);
const coin = 10n ** 18n;
const context = {
  chain,
  quotes: new Set([chain.nativeAsset, erc20AssetRef(chain, usdt)]),
  venues: new Map([
    [router, "kyberswap"],
    [curve, "flap"],
  ]),
};

const accountOf = (address: Address): AccountRef => evmAccountRef(chain, address);
const tradeKey = (trade: WalletTrade): string =>
  `${trade.account}/${trade.txHash}/${String(trade.logIndex)}`;

/** A book in memory, as the store keeps tracked wallets, trades and the cursor. */
interface MemoryBook extends LeaderBook {
  readonly wallets: Map<AccountRef, TrackedLeader>;
  readonly trades: Map<string, WalletTrade>;
  readonly reads: LeaderRead[];
  stored?: WatchCursor | undefined;
  /** The next record throws once. */
  isFailingOnce: boolean;
}

function memoryBook(): MemoryBook {
  const book: MemoryBook = {
    wallets: new Map(),
    trades: new Map(),
    reads: [],
    isFailingOnce: false,
    tracked: async () => Promise.resolve([...book.wallets.values()]),
    cursor: async () => Promise.resolve(book.stored),
    async record(read) {
      if (book.isFailingOnce) {
        book.isFailingOnce = false;
        throw new BinferenceError({ code: "store.busy", message: "The store is busy." });
      }
      for (const { account, sinceBlock, readFrom } of read.wallets) {
        const known = book.wallets.get(account);
        if (known !== undefined && read.to >= readFrom) {
          book.wallets.set(account, {
            account,
            sinceBlock: known.sinceBlock ?? sinceBlock,
            lastBlock: read.to,
          });
        }
      }
      read.trades.forEach((trade) => book.trades.set(tradeKey(trade), trade));
      book.reads.push(read);
      book.stored = { block: read.to, hash: read.toHash };
      return Promise.resolve();
    },
  };
  return book;
}

interface Rig {
  /** The watcher's run, which settles once it stops. */
  readonly done: Promise<void>;
  readonly clock: ManualClock;
  readonly chain: FakeLeaderChain;
  readonly book: MemoryBook;
  readonly watcher: LeaderWatcher;
  readonly failures: string[];
  /** Each request's endpoint and method, oldest first. */
  readonly asked: () => readonly (readonly [string, string])[];
  stop(): void;
}

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
});

interface WatcherParts {
  readonly clock: ManualClock;
  readonly fake: FakeLeaderChain;
  readonly book: MemoryBook;
  /** Reads through a tracer, its logs through a node of their own, with a call timeout. */
  readonly isTraced?: true;
}

const failoverOf = (clock: ManualClock, http: FakeRpcHttp, node: string) =>
  createRpcFailover({
    endpoints: [{ name: node, url: node }],
    http,
    clock,
    timeoutMs: 1_000,
    restMs: 1,
  });

function startWatcher(given: WatcherParts): Rig {
  const { clock, fake, book } = given;
  const http = createFakeRpcHttp({ [url]: fake.endpoint, [logsUrl]: fake.endpoint });
  const rpc = failoverOf(clock, http, url);
  const apart = { tracer: rpc, logsRpc: failoverOf(clock, http, logsUrl), callTimeoutMs: 500 };
  const failures: string[] = [];
  const held: { watcher?: LeaderWatcher } = {};
  const watcher = createLeaderWatcher({
    rpc,
    blocks: createBlockSource({ rpc, clock, blockTimeMs }),
    clock,
    multicall,
    blockTimeMs,
    context,
    feeds: [],
    book,
    // The watcher's state names each failure as it is told.
    onReadFailed: (code) => failures.push(code === held.watcher?.state().fault ? code : "unnamed"),
    ...(given.isTraced === true ? apart : {}),
  });
  held.watcher = watcher;
  const controller = new AbortController();
  const done = watcher.run(controller.signal);
  done.catch(() => undefined);
  const stop = (): void => controller.abort();
  stops.push(stop);
  const asked = () =>
    http
      .requests()
      .map((request) => [request.url, readFakeRpcRequest(request.body).method] as const);
  return { done, clock, chain: fake, book, watcher, failures, stop, asked };
}

function rig(options: Partial<FakeLeaderChainOptions> & { readonly isTraced?: true } = {}): Rig {
  const { isTraced, ...chainOptions } = options;
  const fake = createFakeLeaderChain({ start: 100n, multicall, ...chainOptions });
  const book = memoryBook();
  book.wallets.set(accountOf(leader), { account: accountOf(leader) });
  const traced = isTraced === undefined ? {} : { isTraced };
  return startWatcher({ clock: createManualClock(1_000_000), fake, book, ...traced });
}

// Lets the watcher poll and read until it read the chain's head.
async function settle(subject: Rig, turns = 100): Promise<void> {
  if (subject.book.stored?.block === subject.chain.head()) {
    return;
  }
  if (turns === 0) {
    throw new Error(`The watcher stopped at ${String(subject.book.stored?.block)}.`);
  }
  await subject.clock.advance(blockTimeMs);
  await settle(subject, turns - 1);
}

// The block a read ended at.
function readTo(subject: Rig, block: bigint): LeaderRead | undefined {
  return subject.book.reads.find((each) => each.to === block);
}

// Mines one block of these transactions per entry, while the node is down.
function mineWhileDown(subject: Rig, blocks: readonly (readonly FakeTx[])[]): readonly bigint[] {
  subject.chain.goDown();
  const mined = blocks.map((txs) => subject.chain.mine(txs));
  return mined;
}

// A buy of 1,000 meme for 1 BNB through the router, its tokens arriving in two transfers.
const buy: FakeTx = {
  from: leader,
  to: router,
  value: coin,
  transfers: [
    { token: meme, from: pool, to: leader, value: 600n },
    { token: meme, from: pool, to: leader, value: 400n },
  ],
};

// A sale of 400 meme on the curve, which pays 0.5 BNB from inside the call.
const sale: FakeTx = {
  from: leader,
  to: curve,
  transfers: [{ token: meme, from: leader, to: curve, value: 400n }],
  pays: [{ to: leader, value: coin / 2n }],
  fee: 21_000n,
};

const memeRef = erc20AssetRef(chain, meme);

// The whale sends 90 wallets 1 USDT each: no trade, under the budget.
function sprayOf(block: number): FakeTx {
  const transfers = Array.from({ length: 90 }, (_each, index) => ({
    token: usdt,
    from: whale,
    to: addressOf("6f", block * 100 + index + 1),
    value: 1n,
  }));
  return { from: whale, to: usdt, transfers };
}

function tradesOf(subject: Rig): readonly WalletTrade[] {
  return [...subject.book.trades.values()];
}

describe("leader watcher", () => {
  it("reads a buy split over two transfers and a sale for the coin once each, with the share", async () => {
    const subject = rig();
    await settle(subject);
    const bought = subject.chain.mine([buy]);
    const sold = subject.chain.mine([sale]);
    await settle(subject);
    expect(tradesOf(subject)).toMatchObject([
      {
        account: accountOf(leader),
        block: bought,
        logIndex: 0,
        side: "buy",
        asset: memeRef,
        amount: 1_000n,
        counterAsset: chain.nativeAsset,
        counterAmount: coin,
        venue: "kyberswap",
      },
      {
        block: sold,
        side: "sell",
        asset: memeRef,
        amount: 400n,
        counterAsset: chain.nativeAsset,
        counterAmount: coin / 2n,
        shareSoldBps: 4_000,
        venue: "flap",
      },
    ]);
    expect(tradesOf(subject)[0]?.shareSoldBps).toBeUndefined();
  });

  it("stays in its budget for a wallet with 1,000 transfers in a block and reports the overflow", async () => {
    const subject = rig();
    subject.book.wallets.set(accountOf(whale), { account: accountOf(whale) });
    await settle(subject);
    const before = {
      logs: subject.chain.calls("eth_getLogs"),
      calls: subject.chain.calls("eth_call"),
    };
    const spray = Array.from({ length: 1_000 }, (_unused, index) => ({
      token: usdt,
      from: whale,
      to: addressOf("6f", index + 1),
      value: 1n,
    }));
    const creation: FakeTx = { from: pool };
    const block = subject.chain.mine([{ from: whale, to: usdt, transfers: spray }, buy, creation]);
    await settle(subject);
    const read = readTo(subject, block);
    expect(read?.overflows).toStrictEqual([{ account: accountOf(whale), block, transfers: 1_000 }]);
    expect(read?.trades.map(({ account, side }) => [account, side])).toStrictEqual([
      [accountOf(leader), "buy"],
    ]);
    // One query pair; the whale's transfers start no block, balance or share read.
    expect(subject.chain.calls("eth_getLogs") - before.logs).toBe(2);
    expect(subject.chain.calls("eth_call") - before.calls).toBe(0);
    expect(subject.chain.calls("eth_getBalance")).toBe(0);
  });

  it("asks again for fewer wallets when the endpoint refuses an answer too large, and cuts the one it still refuses", async () => {
    const subject = rig({ maxLogs: 500 });
    subject.book.wallets.set(accountOf(whale), { account: accountOf(whale) });
    await settle(subject);
    const spray = Array.from({ length: 600 }, (_unused, index) => ({
      token: usdt,
      from: whale,
      to: addressOf("6f", index + 1),
      value: 1n,
    }));
    const block = subject.chain.mine([{ from: whale, to: usdt, transfers: spray }, buy]);
    await settle(subject);
    const read = readTo(subject, block);
    expect(read?.overflows).toStrictEqual([{ account: accountOf(whale), block }]);
    expect(read?.trades.map(({ side, asset }) => [side, asset])).toStrictEqual([["buy", memeRef]]);
  });

  it("asks again over half the blocks when a catch-up's answer is too large", async () => {
    const subject = rig({ maxLogs: 200 });
    subject.book.wallets.set(accountOf(whale), { account: accountOf(whale) });
    await settle(subject);
    const readBefore = subject.book.reads.length;
    const [, , last] = mineWhileDown(subject, [[sprayOf(0)], [sprayOf(1)], [sprayOf(2), buy]]);
    const logsBefore = subject.chain.calls("eth_getLogs");
    subject.chain.comeBack();
    await settle(subject);
    const reads = subject.book.reads.slice(readBefore);
    expect(reads.flatMap((read) => read.overflows)).toStrictEqual([]);
    expect(reads.flatMap((read) => read.trades.map(({ block }) => block))).toStrictEqual([last]);
    // The pair over three blocks, refused, then a pair over two and a pair over one.
    expect(subject.chain.calls("eth_getLogs") - logsBefore).toBe(6);
  });

  it("resumes after an outage from the block after its last, with no gap and no double", async () => {
    const subject = rig();
    await settle(subject);
    const quiet: readonly FakeTx[] = [];
    const pattern = [[buy], quiet, quiet, quiet, quiet];
    const blocks = mineWhileDown(subject, [...pattern, ...pattern, ...pattern, ...pattern, [buy]]);
    const readBefore = subject.book.stored?.block;
    await subject.clock.advance(blockTimeMs * 4);
    expect(subject.book.stored?.block).toBe(readBefore);
    subject.chain.comeBack();
    subject.book.isFailingOnce = true;
    await settle(subject);
    expect(subject.failures).toStrictEqual(["store.busy"]);
    expect(subject.watcher.state()).toStrictEqual({
      head: subject.chain.head(),
      read: subject.chain.head(),
    });
    const bought = blocks.filter((_block, index) => index % 5 === 0);
    expect(tradesOf(subject).map(({ block }) => block)).toStrictEqual(bought);
    const recorded = subject.book.reads.flatMap((read) => read.trades.map(tradeKey));
    expect(new Set(recorded).size).toBe(recorded.length);
    const starts = subject.book.reads.slice(1).map(({ from }) => from);
    const nexts = subject.book.reads.slice(0, -1).map(({ to }) => to + 1n);
    expect(starts).toStrictEqual(nexts);
  });

  it("starts again from its stored cursor after a restart, and from the last final block once that block was replaced", async () => {
    const subject = rig();
    await settle(subject);
    subject.stop();
    const missed = subject.chain.mine([buy]);
    subject.chain.mine();
    const again = startWatcher({ clock: subject.clock, fake: subject.chain, book: subject.book });
    await settle(again);
    expect(tradesOf(again).map(({ block }) => block)).toStrictEqual([missed]);
    again.stop();
    subject.chain.reorg(missed + 1n);
    const moved = subject.chain.mine([sale]);
    subject.chain.mine();
    const third = startWatcher({ clock: subject.clock, fake: subject.chain, book: subject.book });
    await settle(third);
    expect(tradesOf(third).map(({ block, side }) => [block, side])).toStrictEqual([
      [missed, "buy"],
      [moved, "sell"],
    ]);
  });

  it("reads again from the last final block when a new block does not follow the one it read", async () => {
    const subject = rig();
    await settle(subject);
    const replaced = subject.chain.mine();
    await settle(subject);
    subject.chain.reorg(replaced);
    const moved = subject.chain.mine([buy]);
    subject.chain.mine();
    subject.chain.answerOnce("eth_getBlockByNumber", { result: null }, "finalized");
    await settle(subject);
    expect(subject.failures).toStrictEqual(["chain.block_missing"]);
    expect(tradesOf(subject).map(({ block, blockHash }) => [block, blockHash])).toStrictEqual([
      [moved, subject.chain.hashOf(moved)],
    ]);
    const last = subject.book.reads.at(-1);
    expect(last?.from).toBeLessThanOrEqual(moved);
  });

  it("reads a wallet tracked later from the head it was first seen at, never its history", async () => {
    const subject = rig();
    await settle(subject);
    subject.chain.mine([
      { ...buy, from: later, transfers: [{ token: meme, from: pool, to: later, value: 5n }] },
    ]);
    await settle(subject);
    subject.book.wallets.set(accountOf(later), { account: accountOf(later) });
    const seen = subject.chain.mine();
    await settle(subject);
    const bought = subject.chain.mine([
      {
        from: later,
        to: router,
        value: coin,
        transfers: [{ token: meme, from: pool, to: later, value: 7n }],
      },
    ]);
    await settle(subject);
    const own = tradesOf(subject).filter((trade) => trade.account === accountOf(later));
    expect(own.map(({ block, amount }) => [block, amount])).toStrictEqual([[bought, 7n]]);
    expect(subject.book.wallets.get(accountOf(later))).toMatchObject({ sinceBlock: seen });
  });

  it("keeps a sale without a share once the state before it is pruned, and a sale at a venue for an unmeasured coin at 0", async () => {
    const subject = rig({
      holdings: [{ account: leader, token: meme, value: 1_000n }],
    });
    await settle(subject);
    subject.chain.goDown();
    const sold = subject.chain.mine([sale]);
    subject.chain.mine();
    subject.chain.pruneBefore(sold + 1n);
    subject.chain.comeBack();
    await settle(subject);
    expect(tradesOf(subject)).toMatchObject([
      {
        block: sold,
        side: "sell",
        amount: 400n,
        counterAsset: chain.nativeAsset,
        counterAmount: 0n,
      },
    ]);
    expect(tradesOf(subject)[0]?.shareSoldBps).toBeUndefined();
  });

  it("reads nothing while no wallet is tracked, and starts at the head once one is", async () => {
    const subject = rig();
    expect(subject.watcher.state()).toStrictEqual({});
    subject.book.wallets.clear();
    await subject.clock.advance(blockTimeMs * 3);
    subject.chain.mine([buy]);
    await subject.clock.advance(blockTimeMs * 3);
    expect(subject.book.reads).toStrictEqual([]);
    subject.book.wallets.set(accountOf(leader), { account: accountOf(leader) });
    const bought = subject.chain.mine([buy]);
    await settle(subject);
    expect(tradesOf(subject).map(({ block }) => block)).toStrictEqual([bought]);
  });

  it("waits for a node behind the head, and reads a block again after a refused read", async () => {
    const subject = rig();
    await settle(subject);
    subject.chain.answerOnce("eth_getBlockByNumber", { result: null });
    const bought = subject.chain.mine([buy]);
    await subject.clock.advance(blockTimeMs);
    subject.chain.answerOnce("eth_getLogs", { error: { code: -32_000, message: "unknown block" } });
    await subject.clock.advance(blockTimeMs);
    subject.chain.answerOnce("eth_getLogs", {
      error: { code: -32_602, message: "invalid params" },
    });
    await settle(subject);
    const sold = subject.chain.mine([sale]);
    subject.chain.answerOnce("eth_call", {
      error: { code: -32_000, message: "execution reverted" },
    });
    await settle(subject);
    expect(subject.failures).toStrictEqual([
      "chain.block_ahead",
      "chain.rpc_error",
      "chain.rpc_error",
    ]);
    expect(tradesOf(subject).map(({ block, side }) => [block, side])).toStrictEqual([
      [bought, "buy"],
      [sold, "sell"],
    ]);
  });

  it("stops on a fault that is not the chain's", async () => {
    const subject = rig();
    subject.book.tracked = async () => Promise.reject(new Error("broken store"));
    await subject.clock.advance(blockTimeMs * 2);
    await expect(subject.done).rejects.toThrow("broken store");
  });

  it("reads the coin a sale got through the tracer once the state before it is pruned, and its logs from a node of their own", async () => {
    const subject = rig({ isTraced: true });
    await settle(subject);
    subject.chain.goDown();
    const sold = subject.chain.mine([sale]);
    subject.chain.mine();
    subject.chain.pruneBefore(sold + 1n);
    subject.chain.comeBack();
    await settle(subject);
    expect(tradesOf(subject)).toMatchObject([
      { block: sold, side: "sell", counterAsset: chain.nativeAsset, counterAmount: coin / 2n },
    ]);
    const logs = subject.asked().filter(([, method]) => method === "eth_getLogs");
    const logNodes = new Set(logs.map(([node]) => node));
    const others = new Set(subject.asked().map(([node, method]) => `${node} ${method}`));
    expect([...logNodes]).toStrictEqual([logsUrl]);
    expect(others.has(`${logsUrl} eth_blockNumber`)).toBe(false);
  });

  it("goes on from each wallet's last block when its cursor was lost, waiting for a new block", async () => {
    const fake = createFakeLeaderChain({ start: 100n, multicall });
    const bought = fake.mine([
      buy,
      { ...buy, from: later, transfers: [{ token: meme, from: pool, to: later, value: 7n }] },
    ]);
    const book = memoryBook();
    book.wallets.set(accountOf(leader), {
      account: accountOf(leader),
      sinceBlock: 100n,
      lastBlock: bought,
    });
    book.wallets.set(accountOf(later), {
      account: accountOf(later),
      sinceBlock: 100n,
      lastBlock: 100n,
    });
    const subject = startWatcher({ clock: createManualClock(1_000_000), fake, book });
    await settle(subject);
    expect(tradesOf(subject).map(({ account }) => account)).toStrictEqual([accountOf(later)]);
    book.wallets.set(accountOf(later), {
      account: accountOf(later),
      sinceBlock: 100n,
      lastBlock: bought,
    });
    book.stored = undefined;
    const quiet = startWatcher({ clock: subject.clock, fake, book });
    subject.stop();
    await subject.clock.advance(blockTimeMs * 3);
    expect(book.stored).toBeUndefined();
    fake.mine();
    await settle(quiet);
    expect(quiet.watcher.state().read).toBe(fake.head());
  });
});
