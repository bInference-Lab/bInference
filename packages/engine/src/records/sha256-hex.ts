import { createHash } from "node:crypto";
import type { Brand } from "@binference/core";
import { z } from "zod";

/**
 * A SHA-256 digest as 64 lowercase hex digits: a ledger hash, a card's terms hash, the hash of a
 * write's args, or the hash of a secret the engine never stores.
 */
export type Sha256Hex = Brand<string, "Sha256Hex">;

const digestPattern = /^[0-9a-f]{64}$/;

/** Whether a text is 64 lowercase hex digits. */
export function isSha256Hex(text: string): text is Sha256Hex {
  return digestPattern.test(text);
}

/** Parses a SHA-256 digest written as 64 lowercase hex digits. */
export const sha256HexSchema: z.ZodType<Sha256Hex, string> = z
  .string()
  .refine(isSha256Hex, { message: "Expected a SHA-256 digest as 64 lowercase hex digits." });

/** The SHA-256 digest of a text's UTF-8 bytes. */
export function sha256Hex(text: string): Sha256Hex {
  return sha256HexSchema.parse(createHash("sha256").update(text, "utf8").digest("hex"));
}
