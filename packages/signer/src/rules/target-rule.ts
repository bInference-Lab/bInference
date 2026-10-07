import type { StepAction } from "../requests/sign-step.schema.js";
import { isAccount, listsAccount, type RuleView } from "./hard-rule.js";
import { readTokenCall } from "./token-call.js";

function sendReaches(view: RuleView, action: Extract<StepAction, { kind: "send" }>): boolean {
  const { transaction } = view;
  const { allowed, step } = view.input;
  if (action.token === undefined) {
    return (
      isAccount(action.recipient, step.chain, transaction.to) &&
      listsAccount(allowed.recipients, step.chain, transaction.to) &&
      transaction.data === "0x"
    );
  }
  const call = readTokenCall(transaction.data);
  return (
    isAccount(action.token, step.chain, transaction.to) &&
    call.kind === "transfer" &&
    isAccount(action.recipient, step.chain, call.recipient) &&
    listsAccount(allowed.recipients, step.chain, call.recipient)
  );
}

function approvalReaches(
  view: RuleView,
  action: Extract<StepAction, { kind: "approve" }>,
): boolean {
  const { allowed, step } = view.input;
  const call = readTokenCall(view.transaction.data);
  return (
    isAccount(action.token, step.chain, view.transaction.to) &&
    call.kind === "approve" &&
    isAccount(action.spender, step.chain, call.spender) &&
    listsAccount(allowed.spenders, step.chain, call.spender)
  );
}

/**
 * Rule 2: `to` is in `allowed`. A call goes to one of the venue's declared contracts; an approval
 * goes to the step's token and names a registry spender; a send pays the confirmed recipient, in
 * the native coin with no calldata or by the token's `transfer`. A cancel is rule 6's.
 */
export function targetHolds(view: RuleView): boolean {
  const { step, allowed } = view.input;
  if (step.replaces?.kind === "cancel") {
    return true;
  }
  const { action } = step;
  if (action.kind === "call") {
    return listsAccount(allowed.contracts, step.chain, view.transaction.to);
  }
  return action.kind === "approve" ? approvalReaches(view, action) : sendReaches(view, action);
}
