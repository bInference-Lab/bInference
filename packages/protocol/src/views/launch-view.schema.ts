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
import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type LaunchpadId, launchpadIdSchema } from "./launch-filter.schema.js";

/**
 * One token a launchpad created, from its create event (protocol spec, section 8.3).
 * `curveProgressBps` and `graduated` are as last read; `insiders` are the wallets the launchpad or
 * the risk step names as exempt or first holders; `creatorLaunches30d` counts the launches the
 * engine recorded for the same creator in the 30 days before.
 */
export interface LaunchView {
  readonly chain: ChainRef;
  readonly token: AssetRef;
  readonly launchpad: LaunchpadId;
  readonly creator: AccountRef;
  readonly quoteToken: AssetRef;
  readonly taxBps?: Bps;
  readonly snipeTaxBps?: Bps;
  readonly curveProgressBps?: Bps;
  readonly graduated: boolean;
  readonly insiders: readonly AccountRef[];
  readonly creatorLaunches30d: number;
  readonly block: number;
  readonly tx: TxHash;
  readonly launchedAt: number;
}

/** Parses one launch. */
export const launchViewSchema: z.ZodType<LaunchView> = z.object({
  chain: chainRefSchema,
  token: assetRefSchema,
  launchpad: launchpadIdSchema,
  creator: accountRefSchema,
  quoteToken: assetRefSchema,
  taxBps: bpsSchema.exactOptional(),
  snipeTaxBps: bpsSchema.exactOptional(),
  curveProgressBps: bpsSchema.exactOptional(),
  graduated: z.boolean(),
  insiders: z.array(accountRefSchema).max(100),
  creatorLaunches30d: z.int().nonnegative(),
  block: z.int().nonnegative(),
  tx: z.string().refine(isTxHash),
  launchedAt: epochMsSchema,
});
