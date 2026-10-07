import type {
  RegisteredChain,
  SignRequest,
  SignStep,
  StepAction,
  TxDraft,
  UnsignedTx,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { SigningTerms } from "./queue-check.js";

/** One step to sign: its place in the plan, its draft, and the unsigned transaction made of it. */
export interface StepToSign {
  readonly record: IntentRecord;
  readonly chain: RegisteredChain;
  readonly terms: SigningTerms;
  readonly index: number;
  readonly draft: TxDraft;
  readonly unsigned: UnsignedTx;
}

// What the step does, read from its draft by the chain's family: an exact approval, or a call.
function actionOf(step: StepToSign): StepAction {
  const call = step.chain.family.readDraft(step.draft);
  if (!call.ok) {
    throw new BinferenceError({
      code: "engine.bad_plan",
      message: `Step ${String(step.index)} of intent ${step.record.id} is a draft its family cannot read.`,
      details: { intent: step.record.id, step: step.index },
    });
  }
  const { target, nativeValue, approval } = call.value;
  return approval === undefined
    ? { kind: "call", nativeValue }
    : { kind: "approve", token: target, spender: approval.spender, amount: approval.amountBase };
}

/**
 * The signing request of one step (spec 5, section 5.1): the unsigned transaction, the intent, the
 * step and what it does, and what authorized the intent, which the signer checks again.
 */
export function signRequestOf(step: StepToSign): SignRequest {
  const signStep: SignStep = { index: step.index, chain: step.chain.ref, action: actionOf(step) };
  return {
    wallet: step.record.walletId,
    tx: step.unsigned,
    intent: step.record.id,
    step: signStep,
    ...step.terms,
  };
}
