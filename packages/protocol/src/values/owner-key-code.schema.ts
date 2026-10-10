import { z } from "zod";

/**
 * Parses the owner key as the CLI reads it from the owner: `bnok1` and the key in base32, in groups
 * of five. It travels only in local operations, over the IPC transport, and is never stored; the
 * engine checks its checksum.
 */
export const ownerKeyCodeSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^bnok1[A-Za-z2-7][A-Za-z2-7 -]{20,200}$/);

/**
 * The owner key as an optional field, for an operation that version 1 of the protocol let a call
 * leave it out of; the engine refuses such a call all the same.
 */
export const optionalOwnerKeyCodeSchema: z.ZodExactOptional<z.ZodType<string, string>> =
  ownerKeyCodeSchema.exactOptional();
