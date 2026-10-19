import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, pageLimitSchema, rowNumberSchema } from "../records/record-fields.js";

/** A wallet the install tracks, as the store keeps it (database spec, `tracked_wallets`). */
export interface TrackedWalletRecord {
  readonly account: AccountRef;
  /** The first block the leader watcher read of it since it was tracked. */
  readonly sinceBlock?: bigint;
  /** The last block the leader watcher read of it. */
  readonly lastBlock?: bigint;
  /** Its blocks whose reads the leader watcher's budget cut (decision 0250). */
  readonly overflowBlocks: number;
  readonly addedAtMs: number;
}

/** Where the leader watcher of a chain stopped: its last block read and that block's hash. */
export interface WatchCursorRecord {
  readonly chain: ChainRef;
  readonly block: bigint;
  readonly blockHash: string;
  readonly atMs: number;
}

/** One trade of a tracked wallet, as the leader watcher read it (`wallet_activity`). */
export interface WalletActivity {
  readonly account: AccountRef;
  readonly block: bigint;
  readonly txHash: TxHash;
  /** The first transfer log of `asset` in the transaction: with the account and hash, its key. */
  readonly logIndex: number;
  readonly side: "buy" | "sell";
  readonly asset: AssetRef;
  /** Base units of `asset`. */
  readonly amount: bigint;
  readonly counterAsset: AssetRef;
  /** Base units of `counterAsset`. */
  readonly counterAmount: bigint;
  readonly valueUsdMicros?: bigint;
  /** For a sale: the share of the holding it took, as the watcher saw it. */
  readonly shareSoldBps?: Bps;
  readonly venue?: string;
  /** The block's time. */
  readonly atMs: number;
}

/** A stored trade, numbered in the order it was stored. */
export interface StoredActivity extends WalletActivity {
  readonly id: number;
}

/** A tracked wallet in one read of the leader watcher. */
export interface ReadWallet {
  readonly account: AccountRef;
  /** The first block read of it since it was tracked: kept when the store has none. */
  readonly sinceBlock: bigint;
  /** The first block of this read that is new for it: a read that reaches it moves its blocks. */
  readonly readFrom: bigint;
}

/** One read of the leader watcher of a chain, from `from` to `to`, stored in one write. */
export interface LeaderReadRecord {
  readonly chain: ChainRef;
  readonly from: bigint;
  readonly to: bigint;
  readonly toHash: string;
  readonly atMs: number;
  readonly wallets: readonly ReadWallet[];
  /** In block and log order. */
  readonly trades: readonly WalletActivity[];
  /** The wallets' blocks the budget cut. */
  readonly overflows: readonly { readonly account: AccountRef; readonly block: bigint }[];
}

/** Which trades of one account to list: newest first, from `fromMs` to `toMs`, after `before`. */
export interface ActivityQuery {
  readonly account: AccountRef;
  readonly fromMs?: number;
  readonly toMs?: number;
  /** The last trade of the page before. */
  readonly before?: { readonly atMs: number; readonly id: number };
  readonly limit: number;
}

const blockSchema = decimalStringSchema;
const hashSchema = z.string().min(1).max(128);

/** Parses a tracked wallet. */
export const trackedWalletRecordSchema: z.ZodType<TrackedWalletRecord> = z.strictObject({
  account: accountRefSchema,
  sinceBlock: blockSchema.exactOptional(),
  lastBlock: blockSchema.exactOptional(),
  overflowBlocks: z.int().nonnegative(),
  addedAtMs: epochMsSchema,
});

/** Parses a watcher's cursor. */
export const watchCursorRecordSchema: z.ZodType<WatchCursorRecord> = z.strictObject({
  chain: chainRefSchema,
  block: blockSchema,
  blockHash: hashSchema,
  atMs: epochMsSchema,
});

const activityShape = {
  account: accountRefSchema,
  block: blockSchema,
  txHash: z.string().refine(isTxHash),
  logIndex: z.int().nonnegative(),
  atMs: epochMsSchema,
  side: z.enum(["buy", "sell"]),
  // The traded assets, then their amounts in base units.
  asset: assetRefSchema,
  counterAsset: assetRefSchema,
  amount: decimalStringSchema,
  counterAmount: decimalStringSchema,
  venue: z.string().min(1).max(64).exactOptional(),
  shareSoldBps: bpsSchema.exactOptional(),
  valueUsdMicros: decimalStringSchema.exactOptional(),
};

/** Parses a trade of a tracked wallet. */
const walletActivitySchema: z.ZodType<WalletActivity> = z.strictObject(activityShape);

/** Parses a stored trade. */
export const storedActivitySchema: z.ZodType<StoredActivity> = z.strictObject({
  ...activityShape,
  id: rowNumberSchema,
});

/** Parses one read of the leader watcher. */
export const leaderReadRecordSchema: z.ZodType<LeaderReadRecord> = z.strictObject({
  chain: chainRefSchema,
  from: blockSchema,
  to: blockSchema,
  toHash: hashSchema,
  atMs: epochMsSchema,
  wallets: z.array(
    z.strictObject({ account: accountRefSchema, sinceBlock: blockSchema, readFrom: blockSchema }),
  ),
  trades: z.array(walletActivitySchema),
  overflows: z.array(z.strictObject({ account: accountRefSchema, block: blockSchema })),
});

/** Parses an activity query. */
export const activityQuerySchema: z.ZodType<ActivityQuery> = z.strictObject({
  account: accountRefSchema,
  fromMs: epochMsSchema.exactOptional(),
  toMs: epochMsSchema.exactOptional(),
  before: z.strictObject({ atMs: epochMsSchema, id: rowNumberSchema }).exactOptional(),
  limit: pageLimitSchema,
});

/** The key of a trade: no two stored trades share it. */
export function activityKeyOf(trade: WalletActivity): string {
  return `${trade.account}/${trade.txHash}/${String(trade.logIndex)}`;
}
