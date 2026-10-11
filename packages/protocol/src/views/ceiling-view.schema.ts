import {
  type AccountRef,
  type AssetRef,
  type ChainRef,
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
} from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";

/**
 * One 24-hour cap of a ceiling (decision 0149): a rolling sum that every wallet of the install
 * shares, of the native coin its transactions send, or of the amounts its approvals of one token
 * name. A venue call or an approval that would take the sum past `limit` is refused.
 */
export interface DayCapView {
  /** The chain's native coin for what transactions send; else the token whose approvals count. */
  readonly asset: AssetRef;
  /** The most the sum may reach, in base units of `asset`. */
  readonly limit: bigint;
  /** The rolling window the sum covers, in seconds. */
  readonly windowSeconds: number;
  /**
   * `limit` in micro-dollars at the floor price caps are sized at, such as $100 a BNB, rounded
   * down; a price above the floor makes the cap worth more.
   */
  readonly floorUsdMicros: bigint;
}

/**
 * A wallet's ceiling, read back from its Privy policy: the chains and venues it may call, the
 * native value one transaction may carry, the addresses it may send to, and its 24-hour caps.
 */
export interface CeilingView {
  readonly wallet: ProtocolId<"wallet">;
  readonly chains: readonly ChainRef[];
  readonly venues: readonly string[];
  /** The most native asset, in base units, one transaction may carry. */
  readonly perTxNative: bigint;
  /** The rescue address and every saved address. */
  readonly recipients: readonly AccountRef[];
  /** Each 24-hour cap the ceiling names, the native coin's first on each chain. */
  readonly dayCaps?: readonly DayCapView[];
  readonly readAt: number;
}

/** What `ceiling/set` changes with the owner key; absent fields stay. */
export interface CeilingChanges {
  readonly chains?: readonly ChainRef[];
  readonly venues?: readonly string[];
  readonly perTxNative?: bigint;
  /**
   * The size of every 24-hour cap in micro-dollars at its floor price, above 0. The caps are the
   * install's, so this changes every live wallet's ceiling, and it comes alone.
   */
  readonly dayCapUsdMicros?: bigint;
}

/** Parses the changes of `ceiling/set`. Unknown fields are refused. */
export const ceilingChangesSchema: z.ZodType<CeilingChanges> = z.strictObject({
  chains: z.array(chainRefSchema).min(1).exactOptional(),
  venues: z.array(venueIdSchema).exactOptional(),
  perTxNative: decimalStringSchema.exactOptional(),
  dayCapUsdMicros: decimalStringSchema.exactOptional(),
});

const dayCapViewSchema: z.ZodType<DayCapView> = z.object({
  asset: assetRefSchema,
  limit: decimalStringSchema,
  windowSeconds: z.int().positive(),
  floorUsdMicros: decimalStringSchema,
});

/** Parses a ceiling view. */
export const ceilingViewSchema: z.ZodType<CeilingView> = z.object({
  wallet: protocolIdSchema("wallet"),
  chains: z.array(chainRefSchema),
  venues: z.array(venueIdSchema),
  perTxNative: decimalStringSchema,
  recipients: z.array(accountRefSchema),
  dayCaps: z.array(dayCapViewSchema).exactOptional(),
  readAt: epochMsSchema,
});
