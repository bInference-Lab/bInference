import { type AssetRef, assetRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * One trade of a watched account (protocol spec, section 7.3): what it bought or sold, for what,
 * at which block and transaction of its asset's chain. `shareSoldBps` is the share of the
 * account's holding a sale took, as the watcher saw it.
 */
export interface ActivityItem {
  readonly at: number;
  readonly block: number;
  readonly tx: TxHash;
  readonly side: "buy" | "sell";
  readonly asset: AssetRef;
  /** Base units of `asset`. */
  readonly amount: bigint;
  readonly counterAsset: AssetRef;
  /** Base units of `counterAsset`. */
  readonly counterAmount: bigint;
  readonly valueUsdMicros?: bigint;
  readonly shareSoldBps?: Bps;
  /** The venue that traded it, when the watcher knows it. */
  readonly venue?: string;
}

/** Parses one trade of a watched account. */
export const activityItemSchema: z.ZodType<ActivityItem> = z.object({
  at: epochMsSchema,
  block: z.int().nonnegative(),
  tx: z.string().refine(isTxHash),
  side: z.enum(["buy", "sell"]),
  asset: assetRefSchema,
  amount: decimalStringSchema,
  counterAsset: assetRefSchema,
  counterAmount: decimalStringSchema,
  valueUsdMicros: decimalStringSchema.exactOptional(),
  shareSoldBps: bpsSchema.exactOptional(),
  venue: z.string().min(1).max(64).exactOptional(),
});
