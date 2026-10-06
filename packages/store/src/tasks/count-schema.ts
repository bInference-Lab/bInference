import { z } from "zod";

/** A number of rows, as a prune task returns it. */
export const rowCountSchema: z.ZodType<number, number> = z.int().nonnegative();

/** A time in epoch milliseconds, as a prune task takes it. */
export const timeInputSchema: z.ZodType<number, number> = z.int().nonnegative();

/** Reads the number of rows a delete or update changed; the count schema refuses a missing one. */
export function changedRows(result: { readonly numAffectedRows?: bigint }): number {
  return Number(result.numAffectedRows);
}
