import { z } from "zod";

/**
 * An instant as a model writes it: an ISO 8601 date-time with its offset, such as
 * `2026-10-20T09:00:00+08:00`, read as epoch milliseconds (decision 0247). A date-time without an
 * offset is refused, so no clock's zone is guessed.
 */
export const isoTimeSchema: z.ZodType<number, string> = z.iso
  .datetime({ offset: true })
  .transform((text) => Date.parse(text))
  .refine(Number.isFinite, { message: "Expected a date that exists." });

/** An instant in epoch milliseconds as the model reads it: ISO 8601 in UTC. */
export function isoTextOf(atMs: number): string {
  return new Date(atMs).toISOString();
}
