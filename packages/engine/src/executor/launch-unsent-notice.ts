import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { type Notice, noticePush } from "../pushes/notice-push.js";
import type { ExecutionRun } from "./executor-run.js";

// The owner's notices of a launch ended on a step that was never signed (decision 0289).
const notSignedKey = "notice.launchNotSigned";
const stepUnsentKey = "notice.launchStepUnsent";

// The last approval among the steps that landed before `index`, as the family reads it.
function standingApprovalOf(run: ExecutionRun, index: number) {
  const { family } = run.plan.chain;
  return run.plan.steps
    .slice(0, index)
    .map((draft) => family.readDraft(draft))
    .findLast((read) => read.ok && read.value.approval !== undefined);
}

// What the notice says of the launch: its symbol, its launchpad, and whether its picture and
// words stayed private, as its stored quote holds no upload's pin.
function launchValuesOf(ended: IntentRecord): Readonly<Record<string, string>> {
  const request = requestDocument.decode(ended.request);
  const isLaunch = request.kind === "launchToken";
  const quote =
    ended.quote === undefined ? undefined : tokenLaunchQuoteDocument.decode(ended.quote);
  const isPrivate = quote !== undefined && quote.pin === undefined;
  return {
    symbol: isLaunch ? request.symbol : "",
    venue: isLaunch ? request.venue : "",
    private: isPrivate ? "yes" : "no",
  };
}

/**
 * The owner's notice of a launch whose step `index` was never signed and never will be (decision
 * 0109): it was a launch, no token was made, whether its picture and words may already be public,
 * and, once its approval landed, the exact approval that still stands for the launchpad. Recovery
 * signs nothing, so the approval is told, not reset (decision 0289).
 */
export function launchUnsentNotice(
  run: ExecutionRun,
  ended: IntentRecord,
  index: number,
): EnginePush {
  const read = ended.state === "cancelled" ? undefined : standingApprovalOf(run, index);
  const approval = read?.ok === true ? read.value.approval : undefined;
  const told = { agent: ended.agentId, intent: ended.id, values: launchValuesOf(ended) };
  const notice: Notice =
    approval === undefined
      ? { key: notSignedKey, ...told }
      : {
          key: stepUnsentKey,
          ...told,
          amounts: { approved: { asset: approval.asset, base: approval.amountBase } },
        };
  return noticePush(notice);
}
