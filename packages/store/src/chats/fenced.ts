import { z } from "zod";

/**
 * A write to the agent database, with the writer fence of the runtime that makes it (runtime
 * spec, section 2.3). The store refuses it with `fenced` when a later start raised the fence.
 */
export type Fenced<T> = T & { readonly fence: number };

/** The refusal of a write made with a fence a later start raised past. */
export type FenceRefusal = "fenced";

/** Parses a writer fence: 1 at the first start, one more at each start after it. */
export const fenceSchema: z.ZodType<number, number> = z.int().positive();
