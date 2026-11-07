import { z } from "zod";

/**
 * Why binference restarts itself (decision 0395): a confirmed config change that applies only
 * after a restart, with the keys it changed, or the owner's own ask, such as `/restart`.
 */
export type RestartWhy =
  | { readonly reason: "config"; readonly changed: readonly string[] }
  | { readonly reason: "owner"; readonly surface: string };

/** Why binference restarted, and when the stopping engine left the record. */
export type RestartRecord = RestartWhy & { readonly atMs: number };

/** Parses the restart record a stopping engine leaves for the next one. */
const restartRecordSchema: z.ZodType<RestartRecord> = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("config"),
    changed: z.array(z.string().min(1).max(200)).max(50),
    atMs: z.int().nonnegative(),
  }),
  z.object({
    reason: z.literal("owner"),
    surface: z.string().min(1).max(40),
    atMs: z.int().nonnegative(),
  }),
]);

/** The restart record in a file's text, or `undefined` when it does not read as one. */
export function restartRecordOf(text: string): RestartRecord | undefined {
  try {
    const parsed = restartRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
