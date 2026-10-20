import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type OrderFillReason, orderFillReasonSchema } from "./order-fill.js";

/** Which fill rows to count: those of an agent's orders, from `fromMs` up to, not including, `toMs`. */
export interface FillCountQuery {
  readonly agentId: Id<"agt">;
  readonly fromMs: number;
  readonly toMs: number;
}

/** Parses a fill count query. */
export const fillCountQuerySchema: z.ZodType<FillCountQuery> = z
  .strictObject({ agentId: idSchema("agt"), fromMs: epochMsSchema, toMs: epochMsSchema })
  .refine((query) => query.fromMs <= query.toMs, { message: "The range ends before it starts." });

/** How many fill rows of the range skipped for one reason. */
export interface SkipCount {
  readonly reason: OrderFillReason;
  readonly count: number;
}

/** What an agent's orders filled and skipped in a range, of any order state or mode. */
export interface FillCounts {
  readonly filled: number;
  /** One entry per reason, the most frequent first, then by reason code. */
  readonly skipped: readonly SkipCount[];
}

/** Parses fill counts. */
export const fillCountsSchema: z.ZodType<FillCounts> = z.strictObject({
  filled: z.int().nonnegative(),
  skipped: z.array(
    z.strictObject({
      reason: orderFillReasonSchema,
      count: z.int().positive(),
    }),
  ),
});

/** Skip counts in the order {@link FillCounts} lists them: the most first, then by reason code. */
export function bySkipCount(left: SkipCount, right: SkipCount): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  return left.reason < right.reason ? -1 : 1;
}
