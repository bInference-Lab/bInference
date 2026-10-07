import type { StepAction } from "../requests/sign-step.schema.js";
import type { RuleView } from "./hard-rule.js";
import { readTokenCall } from "./token-call.js";

/**
 * From here on an allowance is unlimited: the uint256 maximum and the other values tokens and
 * wallets treat as never running out.
 */
const unlimitedAllowance: bigint = 2n ** 255n;

function sendPays(view: RuleView, action: Extract<StepAction, { kind: "send" }>): boolean {
  const { transaction } = view;
  if (action.token === undefined) {
    return transaction.value === action.amount;
  }
  const call = readTokenCall(transaction.data);
  return transaction.value === 0n && call.kind === "transfer" && call.amount === action.amount;
}

function approvalGrants(view: RuleView, action: Extract<StepAction, { kind: "approve" }>): boolean {
  const call = readTokenCall(view.transaction.data);
  return (
    view.transaction.value === 0n &&
    call.kind === "approve" &&
    call.amount <= action.amount &&
    call.amount < unlimitedAllowance
  );
}

/**
 * Rule 3: the value and amounts are the plan's for the step. A call sends exactly the planned
 * native value and moves or approves no token; an approval is never above the step's amount and
 * never unlimited; a send pays exactly the planned amount. A cancel is rule 6's.
 */
export function valueHolds(view: RuleView): boolean {
  const { step } = view.input;
  if (step.replaces?.kind === "cancel") {
    return true;
  }
  const { action } = step;
  if (action.kind === "call") {
    return (
      view.transaction.value === action.nativeValue &&
      readTokenCall(view.transaction.data).kind === "notTokenCall"
    );
  }
  return action.kind === "approve" ? approvalGrants(view, action) : sendPays(view, action);
}
