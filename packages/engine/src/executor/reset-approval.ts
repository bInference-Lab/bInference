import type { TxDraft } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { fillOrderOf } from "../orders/fill-ends.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import type { ExecutionRun } from "./executor-run.js";
import type { SigningTerms } from "./queue-check.js";
import { prepareStep, signAndStore } from "./run-step.js";
import { sendAndWatch } from "./send-and-watch.js";
import { stuckRulesOf } from "./stuck-rules.js";
import { termsNow } from "./terms-now.js";

// The owner's notice of an approval a fill left standing, set back to 0.
const resetNoticeKey = "notice.approvalReset";

// The reset to 0 of the last approval among the steps that landed before `index`: the same token
// and spender, from the same wallet; `undefined` when none of them approved anything.
function resetDraftOf(run: ExecutionRun, index: number): TxDraft | undefined {
  const { family } = run.plan.chain;
  const drafts = run.plan.steps.slice(0, index);
  const approvingDraft = drafts.findLast((draft) => {
    const read = family.readDraft(draft);
    return read.ok && read.value.approval !== undefined;
  });
  const read = approvingDraft === undefined ? undefined : family.readDraft(approvingDraft);
  const approval = read?.ok === true ? read.value : undefined;
  if (approvingDraft === undefined || approval?.approval === undefined) {
    return undefined;
  }
  const reset = {
    from: approvingDraft.from,
    token: approval.target,
    spender: approval.approval.spender,
    amountBase: 0n,
  };
  const drafted = family.approvalDraft(reset);
  return drafted.ok ? drafted.value : undefined;
}

/**
 * Resets to 0 the approval an order's live fill left standing when a later step of its trade
 * cannot be signed, as its order ended or its grant ran out (decision 0211): one more step after
 * the plan, signed under the fill's grant, stored before its send and watched until a block holds
 * it, and the owner's notice. Any other intent, or a fill whose landed steps approved nothing,
 * signs nothing here. A reset that fails is logged; the intent then ends as one never finished.
 */
export async function resetApproval(
  run: ExecutionRun,
  slot: WalletSlot,
  taken: {
    readonly snapshot: IntentSnapshot;
    readonly terms: SigningTerms;
    readonly index: number;
  },
): Promise<void> {
  const { snapshot, index } = taken;
  const { record } = snapshot;
  const draft =
    index > 0 && fillOrderOf(snapshot) !== undefined ? resetDraftOf(run, index) : undefined;
  if (draft === undefined) {
    return;
  }
  const reset = await signReset(run, slot, { record, terms: taken.terms, draft });
  if (reset === undefined) {
    run.parts.log.error("executor.approval_unreset", { intentId: record.id });
    return;
  }
  const watched = await sendAndWatch(run, {
    intent: record,
    transaction: reset,
    rivals: [],
    rules: stuckRulesOf(run, { slot, terms: taken.terms }),
  });
  const token = run.plan.chain.family.readDraft(draft);
  run.parts.log.warn("executor.approval_reset", {
    intentId: record.id,
    errorCode: watched.outcome,
  });
  const values = { token: token.ok ? token.value.target : "" };
  run.parts.publish(
    noticePush({ key: resetNoticeKey, agent: record.agentId, intent: record.id, values }),
  );
}

// The reset prepared at the wallet's next nonce, its terms read again, signed and stored.
async function signReset(
  run: ExecutionRun,
  slot: WalletSlot,
  reset: { readonly record: IntentRecord; readonly terms: SigningTerms; readonly draft: TxDraft },
): Promise<TransactionRecord | undefined> {
  const { record, draft } = reset;
  const ready = await prepareStep(run, slot, { index: run.plan.steps.length, draft });
  const terms = await termsNow(run, reset.terms, { record, kind: "revoke" });
  if (!ready.ok || terms === undefined) {
    return undefined;
  }
  const stored = await signAndStore(run, slot, { record, terms, ready: ready.value });
  return stored.ok ? stored.value : undefined;
}
