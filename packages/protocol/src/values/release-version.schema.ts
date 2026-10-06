import { z } from "zod";

/** Parses an engine release: calver `YYYY.M.PATCH`, such as `2026.10.0`. */
export const releaseVersionSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^\d{4}\.(?:[1-9]|1[0-2])\.\d+$/);
