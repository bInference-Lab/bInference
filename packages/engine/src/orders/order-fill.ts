import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import {
  type IntentReason,
  intentReasons,
  type OrderSkipReason,
  orderSkipReasons,
} from "../intents/intent-reason.js";
import { epochMsSchema, pageLimitSchema } from "../records/record-fields.js";
import { type OrderMove, orderMoveSchema } from "./order-record.js";

/** Why a fill was skipped: the reason its intent ended with, or the order's own before any. */
export type OrderFillReason = IntentReason | OrderSkipReason;

/**
 * One fill of an auto order as `order_fills` keeps it (database spec, section 2.4): `filled` with
 * the intent that filled, or `skipped` with its reason and the intent that ended, if one was
 * stored.
 */
export interface OrderFillRecord {
  readonly id: Id<"fil">;
  readonly orderId: Id<"ord">;
  readonly intentId?: Id<"int">;
  readonly outcome: "filled" | "skipped";
  /** Absent for a fill. */
  readonly reason?: OrderFillReason;
  readonly atMs: number;
}

const fillReasonCodes: ReadonlySet<string> = new Set<string>([
  ...intentReasons,
  ...orderSkipReasons,
]);

/** Parses one fill row. A skip carries a reason and a fill none. */
export const orderFillRecordSchema: z.ZodType<OrderFillRecord> = z
  .strictObject({
    id: idSchema("fil"),
    orderId: idSchema("ord"),
    intentId: idSchema("int").exactOptional(),
    outcome: z.enum(["filled", "skipped"]),
    reason: z
      .string()
      .refine((code): code is OrderFillReason => fillReasonCodes.has(code))
      .exactOptional(),
    atMs: epochMsSchema,
  })
  .refine((row) => (row.outcome === "skipped") === (row.reason !== undefined), {
    message: "A skip carries its reason, and a fill none.",
  });

/**
 * What a paper fill writes on its order in the fill's own transaction (spec 6, section 5): the
 * order's move, the moves that end the other exit orders of a position it emptied, and the fill's
 * row.
 */
export interface OrderFillWrite {
  readonly moves: readonly OrderMove[];
  readonly fill: OrderFillRecord;
}

/**
 * Whether a fill write records its fill on its own order (decision 0197): a `filled` row lands
 * only with its order's move to one fill more than the `fillsBefore` it had; a skip needs none.
 */
export function recordsOwnFill(write: OrderFillWrite, fillsBefore: number): boolean {
  const { fill, moves } = write;
  return (
    fill.outcome !== "filled" ||
    moves.some(({ id, fills }) => id === fill.orderId && fills === fillsBefore + 1)
  );
}

/** Parses an order fill write. */
export const orderFillWriteSchema: z.ZodType<OrderFillWrite> = z.strictObject({
  moves: z.array(orderMoveSchema),
  fill: orderFillRecordSchema,
});

/** A page of one order's fill rows, the newest first. */
export interface OrderFillQuery {
  readonly orderId: Id<"ord">;
  readonly limit: number;
}

/** Parses an order fill query. */
export const orderFillQuerySchema: z.ZodType<OrderFillQuery> = z.strictObject({
  orderId: idSchema("ord"),
  limit: pageLimitSchema,
});
