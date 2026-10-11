import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * A step the drop rule ended that landed after all (decision 0147): a record of its own, linked to
 * the intent, which stays as it ended, and to the transaction a block holds. The rolling 24-hour
 * cap counts the intent again once it has one.
 */
export interface LateLanding {
  readonly intentId: Id<"int">;
  readonly txId: Id<"tx">;
  /** When the executor found the transaction in a block. */
  readonly atMs: number;
}

/** Parses a late landing. */
export const lateLandingSchema: z.ZodType<LateLanding> = z.strictObject({
  intentId: idSchema("int"),
  txId: idSchema("tx"),
  atMs: epochMsSchema,
});
