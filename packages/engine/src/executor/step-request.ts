import type {
  DraftCall,
  RegisteredChain,
  SignRequest,
  SignStep,
  StepAction,
  StepReplacement,
  TxDraft,
  UnsignedTx,
} from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { SigningTerms } from "./queue-check.js";

/** One step to sign: its place in the plan, its draft, and the unsigned transaction made of it. */
export interface StepToSign {
  readonly record: IntentRecord;
  readonly chain: RegisteredChain;
  readonly terms: SigningTerms;
  readonly index: number;
  readonly draft: TxDraft;
  readonly unsigned: UnsignedTx;
  /** Set for a stuck step's speed-up or cancel, which takes the nonce of one signed before. */
  readonly replaces?: StepReplacement;
}

function badPlan(step: StepToSign, problem: string): BinferenceError {
  return new BinferenceError({
    code: "engine.bad_plan",
    message: `Step ${String(step.index)} of intent ${step.record.id} ${problem}.`,
    details: { intent: step.record.id, step: step.index },
  });
}

function callOf(step: StepToSign): DraftCall {
  const call = step.chain.family.readDraft(step.draft);
  if (!call.ok) {
    throw badPlan(step, "is a draft its family cannot read");
  }
  return call.value;
}

// What the step does, read from its draft by the chain's family: an exact approval, or a call.
function actionOf(step: StepToSign): StepAction {
  const { target, nativeValue, approval } = callOf(step);
  return approval === undefined
    ? { kind: "call", nativeValue }
    : { kind: "approve", token: target, spender: approval.spender, amount: approval.amountBase };
}

// A rescue step sends its move's asset, as it is, to the rescue address its card confirmed, and
// the move's wallet signs it (decision 0044): the coin with no call, a token by its transfer.
function rescueSigning(step: StepToSign): {
  readonly wallet: Id<"wal">;
  readonly action: StepAction;
} {
  const { record, chain, index } = step;
  const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
  const move = quote?.moves[index];
  if (quote === undefined || move === undefined) {
    throw badPlan(step, "has no move in its rescue's quote");
  }
  const { target } = callOf(step);
  const amount = move.amount.base;
  const isCoin = move.amount.asset === nativeAssetOf(chain);
  const action: StepAction = isCoin
    ? { kind: "send", recipient: quote.rescue, amount }
    : { kind: "send", recipient: quote.rescue, token: target, amount };
  return { wallet: move.wallet, action };
}

/**
 * The signing request of one step (spec 5, section 5.1): the unsigned transaction, the intent, the
 * step and what it does, what it replaces when it is a speed-up or a cancel, and what authorized
 * the intent, which the signer checks again. A rescue's step is a send its move's wallet signs.
 */
export function signRequestOf(step: StepToSign): SignRequest {
  const signing =
    step.record.kind === "rescue"
      ? rescueSigning(step)
      : { wallet: step.record.walletId, action: actionOf(step) };
  const signStep: SignStep = {
    index: step.index,
    chain: step.chain.ref,
    action: signing.action,
    ...(step.replaces === undefined ? {} : { replaces: step.replaces }),
  };
  return {
    wallet: signing.wallet,
    tx: step.unsigned,
    intent: step.record.id,
    step: signStep,
    ...step.terms,
  };
}
