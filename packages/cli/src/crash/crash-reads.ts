import { join } from "node:path";
import { evmAccountRef, evmChainOf } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import type { Id } from "@binference/core";
import type { EngineStores } from "@binference/engine";
import {
  createSqliteEngineStores,
  engineWorker,
  openDatabase,
  type StoreHost,
} from "@binference/store";
import type { Address, Hex } from "viem";
import { z } from "zod";
import type { CrashChain, RelayedSend } from "./crash-chain.js";

const countSchema = z.string().regex(/^0x[0-9a-f]+$/u);
const poolSchema = z.object({
  pending: z.record(z.string(), z.unknown()),
  queued: z.record(z.string(), z.unknown()),
});
const receiptSchema = z.object({ status: z.string() }).nullable();
// The parent opens engine.sqlite on store workers that run the TypeScript source too.
const storeExecArgv = ["--conditions=@binference/source", "--import", "tsx"];

/** What the chain, the relays and the engine's store held the moment the engine died. */
export interface AtKill {
  /** Whether a relay had received the signed bytes. */
  readonly isRelayed: boolean;
  /** Whether anvil had them. */
  readonly isOnChain: boolean;
  /** The wallet's transactions anvil had mined. */
  readonly mined: number;
  /** The state of each transaction the engine had stored for the wallet. */
  readonly stored: readonly string[];
}

/** The wallet's transactions anvil has mined: its nonce at the latest block. */
export async function minedOf(chain: CrashChain, from: Address): Promise<number> {
  return Number(countSchema.parse(await chain.call("eth_getTransactionCount", [from, "latest"])));
}

/**
 * Reads what the engine's store holds, as the next engine reads it, through a store of its own
 * that is closed once `read` settles.
 */
export async function withStore<T>(
  folder: string,
  read: (stores: EngineStores, signal: AbortSignal, database: StoreHost) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.timeout(30_000);
  const database = await openDatabase({
    file: join(folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: storeExecArgv,
    signal,
  });
  try {
    return await read(createSqliteEngineStores(database), signal, database);
  } finally {
    await database.close();
  }
}

async function storedOf(folder: string, from: Address): Promise<readonly string[]> {
  const account = evmAccountRef(evmChainOf(bsc), from);
  const query = { account, fromNonce: 0, limit: 10 };
  const stored = await withStore(folder, async ({ transactions }, signal) =>
    transactions.list(query, { signal }),
  );
  return stored.map(({ state }) => state);
}

/** The hashes of the transactions the engine stored for one intent. */
export async function hashesOf(folder: string, intent: Id<"int">): Promise<readonly string[]> {
  const stored = await withStore(folder, async ({ transactions }, signal) =>
    transactions.ofIntent(intent, { signal }),
  );
  return stored.flatMap(({ hash }) => (hash === undefined ? [] : [hash]));
}

/** What the chain, the relays and the store held of the wallet when the engine died. */
export async function atKillOf(chain: CrashChain, from: Address, folder: string): Promise<AtKill> {
  const sends = chain.sends().filter((send) => send.from === from);
  return {
    isRelayed: sends.length > 0,
    isOnChain: sends.some(({ isOnChain }) => isOnChain),
    mined: await minedOf(chain, from),
    stored: await storedOf(folder, from),
  };
}

/** The hashes the relays passed on that anvil holds a successful receipt of. */
export async function landedOf(chain: CrashChain, sends: readonly RelayedSend[]): Promise<Hex[]> {
  const onChain = [...new Set(sends.filter((send) => send.isOnChain).map(({ hash }) => hash))];
  const receipts = await Promise.all(
    onChain.map(async (hash) =>
      receiptSchema.parse(await chain.call("eth_getTransactionReceipt", [hash])),
    ),
  );
  return onChain.filter((_, index) => receipts[index]?.status === "0x1");
}

/** The wallet's transactions anvil still holds unmined. */
export async function unminedOf(chain: CrashChain, from: Address): Promise<number> {
  const pool = poolSchema.parse(await chain.call("txpool_content", []));
  const isFrom = (address: string): boolean => address.toLowerCase() === from.toLowerCase();
  return [...Object.keys(pool.pending), ...Object.keys(pool.queued)].filter(isFrom).length;
}
