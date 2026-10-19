import { setTimeout as wait } from "node:timers/promises";
import { type AccountRef, accountRefParts } from "@binference/chain";
import { erc20AssetRef } from "@binference/chain-evm";
import { bscContract, type Fork } from "@binference/chain-evm/fork";
import { BinferenceError, bpsSchema, type Http } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { createVenueHost, type VenueTrade } from "@binference/engine";
import type { StoredActivity } from "@binference/engine/orders";
import { createKyberswapVenue } from "@binference/kyberswap";
import { recordedWallet } from "@binference/kyberswap/testing";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { successOf } from "@binference/plugin-sdk/testing";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseAbi,
  type TransactionReceipt,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClosers } from "../compose/closers.js";
import { composeLeaderWatchers } from "../compose/leader-watches.js";
import { selfHostedChains, selfHostedFeeds } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { launchOnGeniusfun } from "./geniusfun-launch.js";
import { cliCaller, fillAgent, type FillRig, onFillFork, xvs } from "./order-fill-rig.js";

// A leader wallet's trades on a BSC fork, read by the leader watcher from the fork's own blocks:
// a buy and a 40% sale of XVS through KyberSwap's router, and a buy and a 40% sale on the curve of
// a token launched on Genius.fun a moment before. KyberSwap refuses anvil's own accounts, so the
// leader is the recorded wallet, impersonated. KyberSwap's public API quotes; nothing else is
// reached but the fork.
const kyberswapOrigin = "https://aggregator-api.kyberswap.com";
const network = createSystemHttp({ version: "test" });
const kyberswapHttp: Http = {
  async request(request) {
    if (new URL(request.url).origin !== kyberswapOrigin) {
      throw new BinferenceError({
        code: "fork.call_refused",
        message: "The fork test reaches no host but KyberSwap's API.",
      });
    }
    return network.request(request);
  },
};
const leader = getAddress(accountRefParts(recordedWallet).address);
const curveAbi = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
]);
const waitMs = 250;
const readTimeoutMs = 20_000;

/** One trade of the leader as the fork saw it, to compare with what the watcher stored. */
interface Seen {
  readonly tx: string;
  readonly side: "buy" | "sell";
  readonly asset: string;
  readonly amount: bigint;
  /** The coin paid for a buy, or received for a sale, the gas left out. */
  readonly coin: bigint;
  readonly shareSoldBps?: number;
}

// The share of a holding a sale took, in whole basis points, rounded down.
function shareOf(sold: bigint, holding: bigint): number {
  return z.coerce.number().parse((sold * 10_000n) / holding);
}

async function heldOf(fork: Fork, token: Address): Promise<bigint> {
  const args = [leader] as const;
  return fork.client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args,
  });
}

function gasOf(receipts: readonly TransactionReceipt[]): bigint {
  return receipts.reduce(
    (sum, { gasUsed, effectiveGasPrice }) => sum + gasUsed * effectiveGasPrice,
    0n,
  );
}

// Sends calls from the leader, one block each, and answers their receipts.
async function sendAll(
  fork: Fork,
  calls: readonly { readonly to: Address; readonly value?: bigint; readonly data: `0x${string}` }[],
): Promise<readonly TransactionReceipt[]> {
  return calls.reduce<Promise<readonly TransactionReceipt[]>>(async (sent, call) => {
    const done = await sent;
    return [...done, await fork.send({ from: leader, ...call })];
  }, Promise.resolve([]));
}

// What a trade moved: the token held and the coin, the gas left out, before and after.
async function moved(
  fork: Fork,
  token: Address,
  run: () => Promise<readonly TransactionReceipt[]>,
) {
  const [heldBefore, coinBefore] = await Promise.all([
    heldOf(fork, token),
    fork.client.getBalance({ address: leader }),
  ]);
  const receipts = await run();
  const [heldAfter, coinAfter] = await Promise.all([
    heldOf(fork, token),
    fork.client.getBalance({ address: leader }),
  ]);
  expect(receipts.map(({ status }) => status).every((status) => status === "success")).toBe(true);
  const tx = receipts.at(-1)?.transactionHash ?? "";
  const coin = coinAfter - coinBefore + gasOf(receipts);
  return { tx, heldBefore, token: heldAfter - heldBefore, coin };
}

// A trade through KyberSwap's router: its approval first when it sells a token.
async function kyberswapTrade(
  fork: Fork,
  trade: Pick<VenueTrade, "amountIn" | "assetOut">,
  signal: AbortSignal,
) {
  const chains = selfHostedChains();
  const venue = createKyberswapVenue({
    http: kyberswapHttp,
    clientId: () => "binference",
    chains: [{ chain: fork.chain.ref, nativeAsset: fork.chain.nativeAsset, allowedHooks: [] }],
  });
  const host = createVenueHost({
    venues: [venue],
    chains,
    clock: createSystemClock(),
    callTimeoutMs: 20_000,
  });
  const asked = {
    ...trade,
    venue: "kyberswap",
    wallet: recordedWallet,
    maxSlippageBps: bpsSchema.parse(100),
  };
  const quoted = successOf(await host.quote(asked, { signal }));
  const plan = successOf(await host.build(quoted, { signal }));
  const calls = plan.steps.map(({ draft }) => {
    const call = decodeEvmDraft(draft);
    if (!call.ok) {
      throw new BinferenceError({ code: "fork.no_call", message: "A step is no EVM call." });
    }
    return { to: call.value.to, value: call.value.value, data: call.value.data };
  });
  return sendAll(fork, calls);
}

async function kyberswapRound(fork: Fork, signal: AbortSignal): Promise<readonly Seen[]> {
  const asset = erc20AssetRef(fork.chain, xvs);
  const spend = 5n * 10n ** 16n;
  const amountIn = { asset: fork.chain.nativeAsset, base: spend };
  const bought = await moved(fork, xvs, async () =>
    kyberswapTrade(fork, { amountIn, assetOut: asset }, signal),
  );
  const sold = ((bought.heldBefore + bought.token) * 2n) / 5n;
  const sale = { amountIn: { asset, base: sold }, assetOut: fork.chain.nativeAsset };
  const after = await moved(fork, xvs, async () => kyberswapTrade(fork, sale, signal));
  const holding = bought.heldBefore + bought.token;
  return [
    { tx: bought.tx, side: "buy", asset, amount: bought.token, coin: spend },
    {
      tx: after.tx,
      side: "sell",
      asset,
      amount: sold,
      coin: after.coin,
      shareSoldBps: shareOf(sold, holding),
    },
  ];
}

async function curveRound(fork: Fork): Promise<readonly Seen[]> {
  const { token, curve } = await launchOnGeniusfun(fork);
  const asset = erc20AssetRef(fork.chain, token);
  const spend = 10n ** 16n;
  const buy = encodeFunctionData({ abi: curveAbi, functionName: "buy", args: [spend, 0n, leader] });
  const bought = await moved(fork, token, async () =>
    sendAll(fork, [{ to: curve, value: spend, data: buy }]),
  );
  const sold = (bought.token * 2n) / 5n;
  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [curve, sold],
  });
  const sell = encodeFunctionData({
    abi: curveAbi,
    functionName: "sell",
    args: [sold, 0n, leader],
  });
  const after = await moved(fork, token, async () =>
    sendAll(fork, [
      { to: token, data: approve },
      { to: curve, data: sell },
    ]),
  );
  return [
    { tx: bought.tx, side: "buy", asset, amount: bought.token, coin: spend },
    {
      tx: after.tx,
      side: "sell",
      asset,
      amount: sold,
      coin: after.coin,
      shareSoldBps: shareOf(sold, bought.heldBefore + bought.token),
    },
  ];
}

// Waits until `read` answers something `isDone` accepts, polling, or the time is up.
async function until<T>(read: () => Promise<T>, isDone: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + readTimeoutMs;
  const poll = async (): Promise<T> => {
    const value = await read();
    if (isDone(value) || Date.now() > deadline) {
      return value;
    }
    await wait(waitMs);
    return poll();
  };
  return poll();
}

// The leader watcher of the fork's chain, composed as the engine composes it, over the rig's
// stores and its engine's alerts.
function watchersOn(fork: Fork, rig: FillRig) {
  const chains = selfHostedChains();
  const chain = chains.list().find(({ ref }) => ref === fork.chain.ref);
  if (chain === undefined) {
    throw new BinferenceError({ code: "fork.no_chain", message: "The registry lacks the fork." });
  }
  const reads = {
    chain,
    evm: fork.chain,
    rpc: fork.rpc,
    networkFeeCapWeiPerGas: () => 10n ** 9n,
    multicall: bscContract("multicall3", "multicall3"),
  };
  const watchers = composeLeaderWatchers({
    chains,
    reads: new Map([[fork.chain.ref, reads]]),
    feeds: selfHostedFeeds(),
    tracked: rig.stores.trackedWallets,
    clock: createSystemClock(),
  });
  watchers.attach(rig.engine);
  const closers = createClosers();
  watchers.start(closers, createMemoryLogger({ subsystem: "watcher" }));
  return closers;
}

function storedOf(rig: FillRig, account: AccountRef) {
  return async () =>
    rig.stores.trackedWallets.activity(
      { account, limit: 20 },
      { signal: AbortSignal.timeout(5_000) },
    );
}

function seenOf(trade: StoredActivity): Seen {
  const coin = trade.counterAmount;
  const share = trade.shareSoldBps === undefined ? {} : { shareSoldBps: trade.shareSoldBps };
  return {
    tx: trade.txHash,
    side: trade.side,
    asset: trade.asset,
    amount: trade.amount,
    coin,
    ...share,
  };
}

// The watcher read the wallet's first block.
function hasStarted(rows: readonly { readonly sinceBlock?: bigint }[]): boolean {
  return rows[0]?.sinceBlock !== undefined;
}

function firedAtLeast(count: number) {
  return (record: { readonly fires: number } | undefined): boolean => (record?.fires ?? 0) >= count;
}

function tradeText(trade: Seen): string {
  const share = trade.shareSoldBps === undefined ? "" : ` (${String(trade.shareSoldBps)} bp)`;
  const coin = `${String(trade.coin)} wei${share}`;
  return `${trade.side} ${String(trade.amount)} ${trade.asset} for ${coin} in ${trade.tx}`;
}

describe("the leader watcher on a BSC fork", () => {
  it("reads a leader's buy and sale through KyberSwap and on a launch's curve once each, with their shares, and fires the wallet alert", async ({
    signal,
    annotate,
  }) =>
    onFillFork(signal, { token: xvs, flags: [] }, async (rig, fork) => {
      await fork.call("anvil_impersonateAccount", [leader]);
      await fork.call("anvil_setCode", [leader, "0x"]);
      await fork.call("anvil_setBalance", [leader, toHex(10n ** 19n)]);
      const condition = { kind: "wallet", account: recordedWallet } as const;
      const created = await rig.engine.handlers["alert/create"]({
        args: { agent: fillAgent, condition },
        caller: cliCaller,
        signal,
      });
      const alert = successOf(created).alert;
      // The fork's own block answers no logs: its node refuses them. The watcher starts above it.
      await fork.call("evm_mine", []);
      const closers = watchersOn(fork, rig);
      try {
        const tracked = await until(
          async () => rig.stores.trackedWallets.tracked(fork.chain.ref, { signal }),
          hasStarted,
        );
        const startedAt = tracked[0]?.sinceBlock;
        const seen = [...(await kyberswapRound(fork, signal)), ...(await curveRound(fork))];
        const stored = await until(
          storedOf(rig, recordedWallet),
          (rows) => rows.length >= seen.length,
        );
        const fired = await until(
          async () => rig.stores.alerts.get(alert, { signal }),
          firedAtLeast(seen.length),
        );
        expect(stored.map(seenOf).toReversed()).toStrictEqual(seen);
        expect(new Set(stored.map(({ txHash }) => txHash)).size).toBe(seen.length);
        expect(stored.slice(2).map(({ venue }) => venue)).toStrictEqual(["kyberswap", "kyberswap"]);
        expect(fired?.fires).toBe(seen.length);
        await annotate(
          `fork block ${String(fork.block)}, watched from ${String(startedAt)}, leader ${leader}: ${seen
            .map(tradeText)
            .join("; ")}`,
        );
      } finally {
        await closers.closeAll(AbortSignal.timeout(10_000));
      }
    }));
});
