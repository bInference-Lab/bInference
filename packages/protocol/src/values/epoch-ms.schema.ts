import { z } from "zod";

/** Parses a time on the wire: whole epoch milliseconds in UTC, in a field whose name ends `At`. */
export const epochMsSchema: z.ZodType<number, number> = z.int().nonnegative();
