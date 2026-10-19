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
import { type LaunchFilter, launchFilterSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema, pageLimitSchema } from "../records/record-fields.js";

/** One token a launchpad created, as the launch feed read it (database spec, `launches`). */
export interface NewLaunch {
  readonly token: AssetRef;
  /** The launchpad venue's registry id. */
  readonly launchpad: string;
  readonly creator: AccountRef;
  readonly quoteToken: AssetRef;
  /** The token's words and decimals as its creator set them, when the feed read them. */
  readonly symbol?: string;
  readonly name?: string;
  readonly decimals?: number;
  readonly taxBps?: Bps;
  readonly snipeTaxBps?: Bps;
  readonly curveProgressBps?: Bps;
  readonly graduated: boolean;
  readonly insiders: readonly AccountRef[];
  readonly block: bigint;
  readonly blockHash: string;
  readonly txHash: TxHash;
  /** Its create event's index among its block's logs. */
  readonly logIndex: number;
  /** Its block's time. */
  readonly launchedAtMs: number;
}

/** A stored launch, with the launches its creator made in the 30 days before it. */
export interface StoredLaunch extends NewLaunch {
  readonly chain: ChainRef;
  readonly changedAtMs: number;
  readonly creatorLaunches30d: number;
}

/** A stored launch's curve as a later log or read told it. */
export interface LaunchCurveChange {
  readonly token: AssetRef;
  readonly curveProgressBps?: Bps;
  readonly graduated?: boolean;
}

/** One read of the launch feed of a chain, from `from` to `to`, stored in one write. */
export interface LaunchReadRecord {
  readonly chain: ChainRef;
  readonly from: bigint;
  readonly to: bigint;
  readonly toHash: string;
  readonly atMs: number;
  /** In block and log order. */
  readonly launches: readonly NewLaunch[];
  /** In block and log order; a later change of a token wins. */
  readonly changes: readonly LaunchCurveChange[];
}

/** A launch's place in a list: its time, block and log index. */
export interface LaunchPlace {
  readonly launchedAtMs: number;
  readonly block: bigint;
  readonly logIndex: number;
}

/**
 * Which launches of a chain to list, newest first: launched at or after `fromMs`, passing every
 * filter given, after `before`. The feed reads no liquidity, so a filter has no least liquidity.
 */
export interface LaunchQuery {
  readonly chain: ChainRef;
  readonly fromMs?: number;
  readonly filters?: Omit<LaunchFilter, "minLiquidityUsdMicros">;
  readonly before?: LaunchPlace;
  readonly limit: number;
}

const blockSchema = decimalStringSchema;
const hashSchema = z.string().min(1).max(128);
const wordSchema = z.string().max(400);

const newLaunchShape = {
  token: assetRefSchema,
  launchpad: z.string().min(1).max(32),
  creator: accountRefSchema,
  quoteToken: assetRefSchema,
  symbol: wordSchema.exactOptional(),
  name: wordSchema.exactOptional(),
  decimals: z.int().min(0).max(255).exactOptional(),
  taxBps: bpsSchema.exactOptional(),
  snipeTaxBps: bpsSchema.exactOptional(),
  curveProgressBps: bpsSchema.exactOptional(),
  graduated: z.boolean(),
  insiders: z.array(accountRefSchema).max(100),
  block: blockSchema,
  blockHash: hashSchema,
  txHash: z.string().refine(isTxHash),
  logIndex: z.int().nonnegative(),
  launchedAtMs: epochMsSchema,
};

const newLaunchSchema: z.ZodType<NewLaunch> = z.strictObject(newLaunchShape);

/** Parses a stored launch. */
export const storedLaunchSchema: z.ZodType<StoredLaunch> = z.strictObject({
  ...newLaunchShape,
  chain: chainRefSchema,
  changedAtMs: epochMsSchema,
  creatorLaunches30d: z.int().nonnegative(),
});

/** The most blocks one read of the launch feed covers; its reads cover 10 at most. */
const maxLaunchReadBlocks = 1_000n;

const isSpan = (from: bigint, to: bigint): boolean => from <= to && to - from < maxLaunchReadBlocks;

/** Parses one read of the launch feed, of at most 1,000 blocks. */
export const launchReadRecordSchema: z.ZodType<LaunchReadRecord> = z
  .strictObject({
    chain: chainRefSchema,
    from: blockSchema,
    to: blockSchema,
    toHash: hashSchema,
    atMs: epochMsSchema,
    launches: z.array(newLaunchSchema),
    changes: z.array(
      z.strictObject({
        token: assetRefSchema,
        curveProgressBps: bpsSchema.exactOptional(),
        graduated: z.boolean().exactOptional(),
      }),
    ),
  })
  .refine((read: Readonly<{ from: bigint; to: bigint }>) => isSpan(read.from, read.to), {
    message: "A read covers 1 to 1,000 blocks.",
  });

/** Parses a launch query. */
export const launchQuerySchema: z.ZodType<LaunchQuery> = z.strictObject({
  chain: chainRefSchema,
  fromMs: epochMsSchema.exactOptional(),
  filters: launchFilterSchema.exactOptional(),
  before: z
    .strictObject({ launchedAtMs: epochMsSchema, block: blockSchema, logIndex: z.int().min(0) })
    .exactOptional(),
  limit: pageLimitSchema,
});

/** How far back a launch counts toward its creator's launches: 30 days. */
export const creatorWindowMs: number = 30 * 24 * 60 * 60 * 1_000;

/** How long a launch is kept: 90 days (database spec, section 5). */
export const launchKeepMs: number = 90 * 24 * 60 * 60 * 1_000;
