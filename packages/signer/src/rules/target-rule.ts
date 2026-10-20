import type { AccountRef, AuthorizeInput, StepAction } from "@binference/chain";
import { callSelectorOf } from "./call-selector.schema.js";
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

// The contracts of the launch the step trades on, which only a launch wallet may call or approve
// (decision 0217); none for any other wallet.
function launchTargets(input: AuthorizeInput): readonly AccountRef[] {
  return input.wallet.role === "launch" ? (input.allowed.launch ?? []) : [];
}

function approvalReaches(
  view: RuleView,
  action: Extract<StepAction, { kind: "approve" }>,
): boolean {
  const { allowed, step } = view.input;
  const call = readTokenCall(view.transaction.data);
  const spenders = [...allowed.spenders, ...launchTargets(view.input)];
  return (
    isAccount(action.token, step.chain, view.transaction.to) &&
    call.kind === "approve" &&
    isAccount(action.spender, step.chain, call.spender) &&
    listsAccount(spenders, step.chain, call.spender)
  );
}

// A call only a launch wallet makes, by its selector, from any other wallet (decision 0271). An
// entry whose selector cannot be read refuses every call, so the rule fails closed.
function isLaunchOnlyCall(view: RuleView): boolean {
  const { wallet, allowed } = view.input;
  if (wallet.role === "launch") {
    return false;
  }
  const selector = view.transaction.data.slice(2, 10);
  return (allowed.launchOnlyCalls ?? []).some((abi) => {
    const launchOnly = callSelectorOf(abi);
    return launchOnly === undefined || launchOnly === selector;
  });
}

/**
 * Rule 2: `to` is in `allowed`. A call goes to one of the venue's declared contracts; an approval
 * goes to the step's token and names a registry spender; from a launch wallet, a call may also go
 * to, and an approval name, a contract of the launch the step trades on (decision 0217), and only
 * a launch wallet makes a call `allowed` names as a launch wallet's alone (decision 0271); a send
 * pays the confirmed recipient, in the native coin with no calldata or by the token's `transfer`.
 * A cancel is rule 6's.
 */
export function targetHolds(view: RuleView): boolean {
  const { step, allowed } = view.input;
  if (step.replaces?.kind === "cancel") {
    return true;
  }
  const { action } = step;
  if (action.kind === "call") {
    const contracts = [...allowed.contracts, ...launchTargets(view.input)];
    return listsAccount(contracts, step.chain, view.transaction.to) && !isLaunchOnlyCall(view);
  }
  return action.kind === "approve" ? approvalReaches(view, action) : sendReaches(view, action);
}
