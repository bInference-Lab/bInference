import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { type OrderFillWrite, orderFillWriteSchema } from "../orders/order-fill.js";
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
  /**
   * An order's live fill that landed late counts on its order in the same write: its moves and
   * its `filled` row (decision 0211). Absent for any other intent.
   */
  readonly order?: OrderFillWrite;
}

/** Parses a late landing. */
export const lateLandingSchema: z.ZodType<LateLanding> = z.strictObject({
  intentId: idSchema("int"),
  txId: idSchema("tx"),
  atMs: epochMsSchema,
  order: orderFillWriteSchema.exactOptional(),
});
