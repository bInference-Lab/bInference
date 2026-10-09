import { setTimeout as wait } from "node:timers/promises";
import { leastReplacementFee } from "@binference/chain";
import { evmAccountRef } from "@binference/chain-evm";
import type { Fork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import type { TransactionRecord } from "@binference/engine/wallet-queue";
import { getAddress, type Hex, parseTransaction, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { buyIn, onFork, type Rig, startMining, walletKey } from "./executor-rig.js";
import { forkWallet } from "./fork-trading.js";
import { balanceOf, proposeAndTap, reach } from "./rig-actions.js";

// The executor's stuck rules run 20 and 40 blocks after a step's watch began (spec 6, section 6).
// The fork mines only when a test says so, and a step is held out of its blocks by dropping it
// from anvil's pool, as relays that dropped it would.
const live = () => ({ signal: AbortSignal.timeout(5_000) });

// The wallet's stored transactions now.
async function storedNow(rig: Rig, fork: Fork): Promise<readonly TransactionRecord[]> {
  const account = evmAccountRef(fork.chain, forkWallet(walletKey).address);
  return rig.stores.transactions.list({ account, fromNonce: 0, limit: 10 }, live());
}

// The wallet's stored transactions once there are `count`, the last of them sent, waiting for
// at most 30 seconds.
async function storedOnce(
  rig: Rig,
  fork: Fork,
  count: number,
): Promise<readonly TransactionRecord[]> {
  const deadline = Date.now() + 30_000;
  const poll = async (): Promise<readonly TransactionRecord[]> => {
    const stored = await storedNow(rig, fork);
    if ((stored.length >= count && stored.at(-1)?.state === "sent") || Date.now() > deadline) {
      return stored;
    }
    await wait(100);
    return poll();
  };
  return poll();
}

// Waits until the relays got `count` sends, for at most 30 seconds.
async function sendsReach(rig: Rig, count: number): Promise<number> {
  const deadline = Date.now() + 30_000;
  const poll = async (): Promise<number> => {
    if (rig.sends.length >= count || Date.now() > deadline) {
      return rig.sends.length;
    }
    await wait(100);
    return poll();
  };
  return poll();
}

function nth(stored: readonly TransactionRecord[], index: number): TransactionRecord {
  const transaction = stored[index];
  if (transaction === undefined) {
    throw new BinferenceError({ code: "fork.not_stored", message: "A transaction is missing." });
  }
  return transaction;
}

// Holds a sent step out of every block, then mines `blocks` empty blocks past it.
async function holdFor(fork: Fork, transaction: TransactionRecord, blocks: number): Promise<void> {
  await fork.call("anvil_dropTransaction", [transaction.hash]);
  await fork.call("anvil_mine", [toHex(blocks)]);
}

// Mines in the background until the intent reaches `state`, and answers the state it reached.
async function mineUntil(
  rig: Rig,
  fork: Fork,
  goal: { readonly intent: Id<"int">; readonly state: string },
): Promise<string> {
  const miner = new AbortController();
  const mining = startMining(fork, miner.signal);
  try {
    return await reach(rig, goal.intent, goal.state);
  } finally {
    miner.abort();
    await mining;
  }
}

// The call a stored transaction's signed bytes make; the encoding leaves a zero field empty.
function callOf(transaction: TransactionRecord) {
  const { to, value = 0n, data = "0x" } = parseTransaction(transaction.raw as Hex);
  return { to: to === undefined || to === null ? undefined : getAddress(to), value, data };
}

function feesOf(transaction: TransactionRecord): readonly bigint[] {
  const { maxFeePerGas = 0n, maxPriorityFeePerGas = 0n } = parseTransaction(transaction.raw as Hex);
  return [maxFeePerGas, maxPriorityFeePerGas];
}

// Whether a replacement pays at least 10% more than the transaction it replaced, in both fees.
function isRaisedOver(replacement: TransactionRecord, replaced: TransactionRecord): boolean {
  const before = feesOf(replaced);
  return feesOf(replacement).every((fee, index) => fee >= leastReplacementFee(before[index] ?? 0n));
}

async function executionsOf(rig: Rig) {
  return rig.positions.executions({ isPaper: false, after: 0, limit: 10 }, live());
}

describe("a stuck transaction on the BSC fork", () => {
  it("is sent again with the same bytes once stuck and still valid, and fills", async ({
    signal,
  }) => {
    await onFork(signal, { isMining: false }, async (rig, fork) => {
      const before = await balanceOf(fork);
      const intent = await proposeAndTap(rig, signal);
      const first = nth(await storedOnce(rig, fork, 1), 0);
      await holdFor(fork, first, 21);
      expect(await sendsReach(rig, 2)).toBeGreaterThanOrEqual(2);
      await expect(mineUntil(rig, fork, { intent, state: "reconciled" })).resolves.toBe(
        "reconciled",
      );
      expect(rig.custody.signatures()).toBe(1);
      expect(new Set(rig.sends.map(({ raw }) => raw))).toStrictEqual(new Set([first.raw]));
      const stored = await storedNow(rig, fork);
      expect(stored.map(({ state }) => state)).toStrictEqual(["final"]);
      expect(await balanceOf(fork)).toBeGreaterThan(before);
      expect(await executionsOf(rig)).toHaveLength(1);
    });
  });

  it("is sped up at its nonce once still valid after 40 blocks, and fills once", async ({
    signal,
  }) => {
    await onFork(signal, { isMining: false }, async (rig, fork) => {
      const intent = await proposeAndTap(rig, signal);
      const first = nth(await storedOnce(rig, fork, 1), 0);
      await holdFor(fork, first, 21);
      await sendsReach(rig, 2);
      await holdFor(fork, first, 20);
      const speedUp = nth(await storedOnce(rig, fork, 2), 1);
      await expect(mineUntil(rig, fork, { intent, state: "reconciled" })).resolves.toBe(
        "reconciled",
      );
      const stored = await storedNow(rig, fork);
      expect(stored.map(({ state }) => state)).toStrictEqual(["superseded", "final"]);
      expect(speedUp).toMatchObject({
        nonce: first.nonce,
        replaces: { id: first.id, kind: "speedUp" },
      });
      expect(callOf(speedUp)).toStrictEqual(callOf(first));
      expect(isRaisedOver(speedUp, first)).toBe(true);
      await expect(fork.call("eth_sendRawTransaction", [first.raw])).rejects.toThrow(/nonce/i);
      const executions = await executionsOf(rig);
      expect(executions.map(({ txHash }) => txHash)).toStrictEqual([speedUp.hash]);
      expect(executions[0]?.sold.base).toBe(buyIn);
      expect(rig.custody.signatures()).toBe(2);
    });
  });

  it("is cancelled at its nonce once it would fail, and never fills", async ({ signal }) => {
    await onFork(signal, { isMining: false }, async (rig, fork) => {
      const before = await balanceOf(fork);
      const intent = await proposeAndTap(rig, signal);
      const first = nth(await storedOnce(rig, fork, 1), 0);
      // The swap's deadline is 60 seconds out: two minutes later it reverts.
      await fork.call("evm_increaseTime", [120]);
      await holdFor(fork, first, 21);
      const cancel = nth(await storedOnce(rig, fork, 2), 1);
      await expect(mineUntil(rig, fork, { intent, state: "failed_onchain" })).resolves.toBe(
        "failed_onchain",
      );
      const record = await rig.stores.intents.get(intent, live());
      expect(record?.reason).toBe("stuck_cancelled");
      const stored = await storedNow(rig, fork);
      expect(stored.map(({ state }) => state)).toStrictEqual(["superseded", "included"]);
      expect(cancel).toMatchObject({
        nonce: first.nonce,
        replaces: { id: first.id, kind: "cancel" },
      });
      const self = { to: forkWallet(walletKey).address, value: 0n, data: "0x" };
      expect(callOf(cancel)).toStrictEqual(self);
      expect(isRaisedOver(cancel, first)).toBe(true);
      await expect(fork.call("eth_sendRawTransaction", [first.raw])).rejects.toThrow(/nonce/i);
      expect(await balanceOf(fork)).toBe(before);
      expect(await executionsOf(rig)).toStrictEqual([]);
      expect(rig.custody.signatures()).toBe(2);
    });
  });
});
