import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * The breaker as its source answers it now (decision 0439): whether it is pulled, the version of
 * its row, which rises with every move and never goes down, and when it last moved.
 */
export interface BreakerState {
  readonly pulled: boolean;
  readonly version: number;
  readonly changedAtMs?: number;
}

/** Parses a breaker state: a version is a whole number of at least 0. */
export const breakerStateSchema: z.ZodType<BreakerState> = z.strictObject({
  pulled: z.boolean(),
  version: z.int().nonnegative(),
  changedAtMs: epochMsSchema.exactOptional(),
});
