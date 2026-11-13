import type { QuotaCall } from "@binference/engine/quotas";
import { z } from "zod";

/**
 * A write's task input with the quota its caller handed it (decision 0431): the most the write may
 * leave, which the task counts in its own transaction; none when no quota holds.
 */
export interface QuotaWrite<Write> {
  readonly write: Write;
  readonly quota?: number;
}

/** Parses a write with its quota. */
export function quotaWriteSchema<Write, Encoded>(
  write: z.ZodType<Write, Encoded>,
): z.ZodType<QuotaWrite<Write>, { readonly write: Encoded; readonly quota?: number }> {
  return z.strictObject({ write, quota: z.int().nonnegative().exactOptional() });
}

/** The task input of a write and the call that carries its quota. */
export function quotaWriteOf<Write>(write: Write, call: QuotaCall): QuotaWrite<Write> {
  return call.quota === undefined ? { write } : { write, quota: call.quota };
}
