import { type AssetRef, assetRefParts, isTxHash, type TxHash } from "@binference/chain";
import { type Bps, type Id } from "@binference/core";
import { testCoin, testToken } from "../intents/test-intents.js";
import type { StoredActivity, WalletActivity } from "../leaders/tracked-wallet-record.js";
import type { TestEngine } from "../operations/test-engine.js";
import {
  copyStateDocument,
  copyStateOf,
  type CopyState,
  type CopyTaking,
  takenState,
} from "./copy-state.js";
import { moveOrder } from "./order-machine.js";
import { storedOrder, testLeader } from "./test-orders.js";

const live = { signal: new AbortController().signal };

/** A copy order's state as the store keeps it now, which must read. */
export async function copyStateNow(test: TestEngine, order: Id<"ord">): Promise<CopyState> {
  const state = copyStateOf((await storedOrder(test, order)).triggerState);
  if (state === undefined) {
    throw new Error(`Expected order ${order} to keep a copy state.`);
  }
  return state;
}

/** Writes a copy order's take of a leader's trade, as its runner does before the trade's fill. */
export async function takeTrade(
  test: TestEngine,
  order: Id<"ord">,
  taking: Omit<CopyTaking, "take">,
): Promise<void> {
  const read = await storedOrder(test, order);
  const state = await copyStateNow(test, order);
  const triggerState = copyStateDocument.encode(takenState(state, taking));
  const move = moveOrder(read, { type: "trigger_kept", triggerState }, test.clock.now());
  const written = move.ok ? await test.stores.orders.move([move.value], live) : undefined;
  if (written?.ok !== true) {
    throw new Error(`Expected order ${order} to take trade ${String(taking.id)}.`);
  }
}

/** Takes a leader's trade for a copy order and runs its fill, answering what the fill came to. */
export async function copyTrade(
  test: TestEngine,
  order: Id<"ord">,
  taking: Omit<CopyTaking, "take">,
): Promise<string> {
  await takeTrade(test, order, taking);
  return test.engine.fillOrder({ order, price: { decimals: 0 } }, live);
}

/** A leader transaction the copy tests' takes name. */
export const testLeaderTx: TxHash = txOf(1n);

function txOf(n: bigint): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  if (!isTxHash(hash)) {
    throw new Error("Expected a transaction hash.");
  }
  return hash;
}

/**
 * The test leader's trade `n` in block `n`, at `atMs`: a buy of the token for `coinBase` of the
 * coin, or a sale of it taking `shareSoldBps` of its holding, unknown when absent.
 */
export function leaderTrade(
  n: number,
  call: {
    readonly side: "buy" | "sell";
    readonly atMs: number;
    readonly asset?: AssetRef;
    readonly shareSoldBps?: Bps;
    /** What a buy paid, or a sale received, of the coin; a tenth of a coin when absent. */
    readonly coinBase?: bigint;
  },
): WalletActivity {
  const { side, atMs, asset = testToken, shareSoldBps, coinBase = 10n ** 17n } = call;
  return {
    account: testLeader,
    block: BigInt(n),
    txHash: txOf(BigInt(n)),
    logIndex: 0,
    side,
    asset,
    amount: 1_000_000n,
    counterAsset: testCoin,
    counterAmount: coinBase,
    ...(shareSoldBps === undefined ? {} : { shareSoldBps }),
    atMs,
  };
}

/**
 * Stores the leader's trades as one read of the leader watcher does, the read reaching 100 blocks
 * past the last, and answers them stored.
 */
export async function storeTrades(
  test: TestEngine,
  trades: readonly WalletActivity[],
): Promise<readonly StoredActivity[]> {
  const blocks = trades.map(({ block }) => block);
  const from = blocks.reduce((low, block) => (block < low ? block : low), blocks[0] ?? 0n);
  // The watcher read on well past the trades, so each is deep enough to copy.
  const to = blocks.reduce((high, block) => (block > high ? block : high), 0n) + 100n;
  const read = {
    chain: assetRefParts(testToken).chain,
    from,
    to,
    toHash: txOf(to),
    atMs: test.clock.now(),
    wallets: [{ account: testLeader, sinceBlock: from, readFrom: from }],
    trades,
    overflows: [],
  };
  return test.stores.trackedWallets.record(read, live);
}
