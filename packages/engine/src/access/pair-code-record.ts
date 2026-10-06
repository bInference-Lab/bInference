import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** A single-use pairing code, kept as the SHA-256 of the code; it works once, before it expires. */
export interface PairCodeRecord {
  readonly codeHash: Sha256Hex;
  readonly expiresAtMs: number;
  readonly usedAtMs?: number;
}

/** Parses a pairing code record. */
export const pairCodeRecordSchema: z.ZodType<PairCodeRecord> = z.strictObject({
  codeHash: sha256HexSchema,
  expiresAtMs: epochMsSchema,
  usedAtMs: epochMsSchema.exactOptional(),
});

/** One use of a pairing code: the hash of the code given and when. */
export interface PairCodeUse {
  readonly codeHash: Sha256Hex;
  readonly atMs: number;
}

/** Parses a pairing code use. */
export const pairCodeUseSchema: z.ZodType<PairCodeUse> = z.strictObject({
  codeHash: sha256HexSchema,
  atMs: epochMsSchema,
});
