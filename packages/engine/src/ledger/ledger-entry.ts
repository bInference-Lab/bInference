import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowNumberSchema, shortTextSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** A ledger entry before the store places it at the end of the chain. */
export interface LedgerDraft {
  readonly id: Id<"led">;
  readonly atMs: number;
  /** The agent it concerns; absent for an entry about the whole install. */
  readonly agentId?: Id<"agt">;
  /** What happened, such as an intent state or `freeze`. */
  readonly kind: string;
  /** The id of the thing it concerns, such as the intent. */
  readonly subject?: string;
  readonly data: JsonValue;
}

const draftShape = {
  id: idSchema("led"),
  atMs: epochMsSchema,
  agentId: idSchema("agt").exactOptional(),
  kind: shortTextSchema,
  subject: shortTextSchema.exactOptional(),
  data: jsonValueSchema,
};

/** Parses a ledger draft. */
export const ledgerDraftSchema: z.ZodType<LedgerDraft> = z.strictObject(draftShape);

/**
 * One entry of the append-only, hash-chained ledger. `seq` counts from 1 with no gap; `prevHash`
 * is the hash of the entry before, 64 zeros for the first.
 */
export interface LedgerEntry extends LedgerDraft {
  readonly seq: number;
  readonly prevHash: Sha256Hex;
  readonly hash: Sha256Hex;
}

/** Parses a ledger entry. */
export const ledgerEntrySchema: z.ZodType<LedgerEntry> = z.strictObject({
  ...draftShape,
  seq: rowNumberSchema,
  prevHash: sha256HexSchema,
  hash: sha256HexSchema,
});
