import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * One agent wallet as the store keeps it: the owner's label for it and when it was made. Its
 * accounts come from custody, which holds the wallet.
 */
export interface WalletRecord {
  readonly id: Id<"wal">;
  readonly agentId: Id<"agt">;
  readonly label: string;
  readonly createdAtMs: number;
  readonly archivedAtMs?: number;
}

/** Parses a wallet record. */
export const walletRecordSchema: z.ZodType<WalletRecord> = z.strictObject({
  id: idSchema("wal"),
  agentId: idSchema("agt"),
  label: z.string().min(1).max(64),
  createdAtMs: epochMsSchema,
  archivedAtMs: epochMsSchema.exactOptional(),
});

/** Which wallets a list call reads: one agent's, or every agent's when it names none. */
export interface WalletQuery {
  readonly agentId?: Id<"agt">;
}

/** Parses a wallet query. */
export const walletQuerySchema: z.ZodType<WalletQuery> = z.strictObject({
  agentId: idSchema("agt").exactOptional(),
});

/** The most wallets one list call returns, oldest first. */
export const walletListLimit = 1_000;
