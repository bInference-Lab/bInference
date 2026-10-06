import { z } from "zod";

/**
 * Parses the owner key as the CLI reads it from the owner: `bnok1` and the key in base32, in groups
 * of five. It travels only in local operations, over the IPC transport, and is never stored; the
 * engine checks its checksum.
 */
export const ownerKeyCodeSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^bnok1[A-Za-z2-7][A-Za-z2-7 -]{20,200}$/);
