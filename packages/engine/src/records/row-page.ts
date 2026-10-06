import { z } from "zod";
import { pageLimitSchema } from "./record-fields.js";

/** One page of rows numbered in order: those after row `after` (0 for the first), at most `limit`. */
export interface RowPage {
  readonly after: number;
  readonly limit: number;
}

/** Parses a row page. */
export const rowPageSchema: z.ZodType<RowPage> = z.strictObject({
  after: z.int().nonnegative(),
  limit: pageLimitSchema,
});
