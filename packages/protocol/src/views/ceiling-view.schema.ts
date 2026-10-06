import {
  type AccountRef,
  type ChainRef,
  accountRefSchema,
  chainRefSchema,
} from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";

/**
 * A wallet's ceiling, read back from its Privy policy: the chains and venues it may call, the
 * native value one transaction may carry, and the addresses it may send to.
 */
export interface CeilingView {
  readonly wallet: ProtocolId<"wallet">;
  readonly chains: readonly ChainRef[];
  readonly venues: readonly string[];
  /** The most native asset, in base units, one transaction may carry. */
  readonly perTxNative: bigint;
  /** The rescue address and every saved address. */
  readonly recipients: readonly AccountRef[];
  readonly readAt: number;
}

/** What `ceiling/set` changes with the owner key; absent fields stay. */
export interface CeilingChanges {
  readonly chains?: readonly ChainRef[];
  readonly venues?: readonly string[];
  readonly perTxNative?: bigint;
}

/** Parses the changes of `ceiling/set`. Unknown fields are refused. */
export const ceilingChangesSchema: z.ZodType<CeilingChanges> = z.strictObject({
  chains: z.array(chainRefSchema).min(1).exactOptional(),
  venues: z.array(venueIdSchema).exactOptional(),
  perTxNative: decimalStringSchema.exactOptional(),
});

/** Parses a ceiling view. */
export const ceilingViewSchema: z.ZodType<CeilingView> = z.object({
  wallet: protocolIdSchema("wallet"),
  chains: z.array(chainRefSchema),
  venues: z.array(venueIdSchema),
  perTxNative: decimalStringSchema,
  recipients: z.array(accountRefSchema),
  readAt: epochMsSchema,
});
