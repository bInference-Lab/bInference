import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  assetRefParts,
  type DraftCall,
  type RegisteredChain,
  type SignRequest,
  type SignStep,
  type StepAction,
  type StepReplacement,
  type TxDraft,
  type UnsignedTx,
} from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import { revokeQuoteDocument } from "../intents/revoke-quote.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
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

// A send of an amount, as it is, to a recipient: the coin with no call, a token by its transfer.
function sendAction(step: StepToSign, recipient: AccountRef, amount: Amount): StepAction {
  const { target } = callOf(step);
  return amount.asset === nativeAssetOf(step.chain)
    ? { kind: "send", recipient, amount: amount.base }
    : { kind: "send", recipient, token: target, amount: amount.base };
}

// A rescue step sends its move's asset to the rescue address its card confirmed, and the move's
// wallet signs it (decision 0044).
function rescueSigning(step: StepToSign): {
  readonly wallet: Id<"wal">;
  readonly action: StepAction;
} {
  const { record, index } = step;
  const quote = record.quote === undefined ? undefined : rescueQuoteDocument.decode(record.quote);
  const move = quote?.moves[index];
  if (quote === undefined || move === undefined) {
    throw badPlan(step, "has no move in its rescue's quote");
  }
  return { wallet: move.wallet, action: sendAction(step, quote.rescue, move.amount) };
}

// A send's one step pays the amount its card confirmed to the address the card showed, a send by
// name's included (spec 6, section 10): the intent's wallet signs it.
function sendSigning(step: StepToSign): StepAction {
  const { record } = step;
  if (record.quote === undefined) {
    throw badPlan(step, "has no send quote");
  }
  const { recipient, amount } = sendQuoteDocument.decode(record.quote);
  return sendAction(step, recipient, amount);
}

// A revoke's one step approves the spender its card named for exactly zero of the token (decision
// 0309), whatever its draft encodes: the signer bounds the approval by this amount.
function revokeSigning(step: StepToSign): StepAction {
  const { record } = step;
  if (record.quote === undefined) {
    throw badPlan(step, "has no revoke quote");
  }
  const { token, spender } = revokeQuoteDocument.decode(record.quote);
  const { chain, assetReference } = assetRefParts(token);
  const contract = accountRefSchema.parse(`${chain}:${assetReference}`);
  return { kind: "approve", token: contract, spender, amount: 0n };
}

// What a step does: a send's or a revoke's from its quote, any other's as its draft reads.
function actionFor(step: StepToSign): StepAction {
  const { kind } = step.record;
  if (kind === "send") {
    return sendSigning(step);
  }
  return kind === "revokeApproval" ? revokeSigning(step) : actionOf(step);
}

// What a step does and who signs it: a rescue's move its wallet signs, else the intent's wallet.
function signingOf(step: StepToSign): { readonly wallet: Id<"wal">; readonly action: StepAction } {
  const { record } = step;
  return record.kind === "rescue"
    ? rescueSigning(step)
    : { wallet: record.walletId, action: actionFor(step) };
}

/**
 * The signing request of one step (spec 5, section 5.1): the unsigned transaction, the intent, the
 * step and what it does, what it replaces when it is a speed-up or a cancel, and what authorized
 * the intent, which the signer checks again. A rescue's step is a send its move's wallet signs,
 * and a send's step a send to the address its card confirmed.
 */
export function signRequestOf(step: StepToSign): SignRequest {
  const signing = signingOf(step);
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
