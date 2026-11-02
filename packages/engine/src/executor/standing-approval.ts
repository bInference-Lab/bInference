import type { TokenApproval } from "@binference/chain";
import type { ExecutionRun } from "./executor-run.js";

/**
 * The last approval among the plan's steps before step `index`, as the chain's family reads it:
 * the approval that still stands once those steps landed and step `index` never did.
 */
export function standingApprovalOf(
  run: Pick<ExecutionRun, "plan">,
  index: number,
): TokenApproval | undefined {
  const { family } = run.plan.chain;
  const read = run.plan.steps
    .slice(0, index)
    .map((draft) => family.readDraft(draft))
    .findLast((step) => step.ok && step.value.approval !== undefined);
  return read?.ok === true ? read.value.approval : undefined;
}
