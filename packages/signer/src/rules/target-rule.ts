import type { AccountRef, AuthorizeInput, StepAction } from "@binference/chain";
import { callInputsHold } from "./call-inputs.js";
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

// A spender only a wallet of another role may approve, such as a bridge wallet's depository from
// a main wallet (decision 0303).
function isOtherRolesSpender(view: RuleView, spender: string): boolean {
  const { wallet, allowed, step } = view.input;
  return (allowed.walletOnlySpenders ?? []).some(
    (item) => item.role !== wallet.role && isAccount(item.spender, step.chain, spender),
  );
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
    !listsAccount(allowed.unapproved ?? [], step.chain, view.transaction.to) &&
    call.kind === "approve" &&
    isAccount(action.spender, step.chain, call.spender) &&
    listsAccount(spenders, step.chain, call.spender) &&
    !isOtherRolesSpender(view, call.spender)
  );
}

// Whether the call is to a function its contract's venue declares (decision 0302): a contract
// with declared functions takes no other, and a contract of the launch the step trades on takes
// only the launch calls declared. An entry whose selector cannot be read matches no call, so the
// rule fails closed. A contract no entry names takes any call, as its ceiling decides.
function isDeclaredCall(view: RuleView, launch: readonly AccountRef[]): boolean {
  const { allowed, step } = view.input;
  const { to, data } = view.transaction;
  const onLaunch = listsAccount(launch, step.chain, to);
  const declared = (allowed.calls ?? []).filter((call) =>
    call.contract === undefined ? onLaunch : isAccount(call.contract, step.chain, to),
  );
  const selector = data.slice(2, 10);
  return declared.length === 0 || declared.some((call) => callSelectorOf(call.abi) === selector);
}

// A call only a wallet of another role makes, by its selector, such as a launch wallet's create call
// from any other wallet (decision 0271). An entry whose selector cannot be read refuses every call
// from a wallet of another role, so the rule fails closed.
function isOtherRolesCall(view: RuleView): boolean {
  const { wallet, allowed } = view.input;
  const selector = view.transaction.data.slice(2, 10);
  return (allowed.walletOnlyCalls ?? []).some(({ role, abi }) => {
    const onlyFor = callSelectorOf(abi);
    return wallet.role !== role && (onlyFor === undefined || onlyFor === selector);
  });
}

/**
 * Rule 2: `to` is in `allowed`. A call goes to one of the venue's declared contracts and calls a
 * function declared on it (decision 0302); an approval goes to the step's token, never to a
 * contract `allowed.unapproved` lists (decision 0304), and names a registry spender, never one
 * only a wallet of another role may approve (decision 0303); from a launch wallet, a call may also go
 * to, and an approval name, a contract of the launch the step trades on (decision 0217), and only
 * a launch wallet makes a call `allowed` names as a launch wallet's alone (decision 0271), and a
 * call's pinned, equal and empty inputs are what `allowed.callInputs` says (decision 0302); a send
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
    const launch = launchTargets(view.input);
    return (
      listsAccount([...allowed.contracts, ...launch], step.chain, view.transaction.to) &&
      isDeclaredCall(view, launch) &&
      !isOtherRolesCall(view) &&
      callInputsHold(view, "who")
    );
  }
  return action.kind === "approve" ? approvalReaches(view, action) : sendReaches(view, action);
}
