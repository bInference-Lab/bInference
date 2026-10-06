import type { Result } from "@binference/core";
import { z } from "zod";

/** Builds the schema of a task's `Result`: its value, or one of its expected errors. */
export function resultSchema<T, E extends string>(
  value: z.ZodType<T>,
  errors: readonly [E, ...E[]],
): z.ZodType<Result<T, E>> {
  return z.union([
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: z.enum(errors) }),
  ]);
}
