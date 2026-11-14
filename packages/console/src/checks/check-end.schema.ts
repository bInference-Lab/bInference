import { type CheckReportView, checkReportViewSchema } from "@binference/protocol";
import * as z from "zod/mini";

/** How a `check/run` job ended: with its report, or with an error's code. */
export type CheckEnd =
  | { readonly job: string; readonly report: CheckReportView }
  | { readonly job: string; readonly code: string };

const endSchema = z.object({
  job: z.string(),
  op: z.string(),
  result: z.optional(z.unknown()),
  error: z.optional(z.object({ code: z.string() })),
});

/**
 * The end of a `check/run` job from a push's data on the `job` topic, or `undefined` for any other
 * job's end or data that does not read.
 */
export function readCheckEnd(data: unknown): CheckEnd | undefined {
  const parsed = endSchema.safeParse(data);
  if (!parsed.success || parsed.data.op !== "check/run") {
    return undefined;
  }
  const { job, result, error } = parsed.data;
  if (error !== undefined) {
    return { job, code: error.code };
  }
  const report = checkReportViewSchema.safeParse(result);
  return report.success ? { job, report: report.data } : undefined;
}
