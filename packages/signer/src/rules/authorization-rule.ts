import {
  type ApprovalModeNow,
  type AutoModeGrant,
  checkAutoModeGrant,
  checkFillGrant,
  type FillGrant,
  type FillSourceNow,
  type SignAuthorization,
} from "@binference/chain";
import type { RuleView } from "./hard-rule.js";

// The fee the auto grant caps, from the auto test's parts the transaction shows (intent-states
// spec, section 5): never a send, and a fee per gas the grant's cap can judge. A cancel moves
// nothing, so its fee needs no cap. `undefined` when the transaction fails those parts.
function cappedFee(view: RuleView): { readonly feePerGasNativeBase?: bigint } | undefined {
  const { step } = view.input;
  if (step.replaces?.kind === "cancel") {
    return {};
  }
  const fee = view.transaction.feePerGas;
  return step.action.kind === "send" || fee === undefined
    ? undefined
    : { feePerGasNativeBase: fee };
}

// The grant holds as `checkAutoModeGrant` of `@binference/chain` reads it: the engine's tests hold
// the grants it makes to the same check.
function autoHolds(view: RuleView, grant: AutoModeGrant, current: ApprovalModeNow): boolean {
  const fee = cappedFee(view);
  if (fee === undefined) {
    return false;
  }
  const { intent, termsHash } = view.input;
  const check = { intent, termsHash, approvalMode: current, nowMs: view.nowMs, ...fee };
  return checkAutoModeGrant(grant, check).ok;
}

/**
 * How long after its confirmation expired a cancel of the confirmed intent still signs (decision
 * 0116): one trade card's lifetime.
 */
const cancelGraceMs = 60_000;

// A cancel moves nothing, so it still signs shortly after the owner's confirmation expired
// (decision 0116).
function isCancelInGrace(view: RuleView, expiresAtMs: number): boolean {
  return view.input.step.replaces?.kind === "cancel" && view.nowMs < expiresAtMs + cancelGraceMs;
}

// No card shows a fee per gas, so nothing authorizes one above the chain's network fee cap in the
// settings (decision 0143); a chain with no cap there signs nothing.
function isFeeUnderCap(view: RuleView): boolean {
  const fee = view.transaction.feePerGas;
  const cap = view.settings.networkFeeCaps.find(({ chain }) => chain === view.input.step.chain);
  return cap !== undefined && fee !== undefined && fee <= cap.feePerGasBase;
}

// The fill grant holds as `checkFillGrant` of `@binference/chain` reads it, against its source as
// the engine read it right before signing: one fill of an active order or webhook rule the owner
// confirmed, which recorded no fill since, spending at most the fill's size (decisions 0210 and
// 0338).
function fillHolds(view: RuleView, grant: FillGrant, current: FillSourceNow): boolean {
  const { intent, termsHash, step } = view.input;
  const isCancel = step.replaces?.kind === "cancel";
  const fee = view.transaction.feePerGas;
  const check = {
    intent,
    termsHash,
    source: current,
    action: step.action,
    isCancel,
    stepIndex: step.index,
    nowMs: view.nowMs,
    ...(isCancel || fee === undefined ? {} : { feePerGasNativeBase: fee }),
  };
  return (isCancel || fee !== undefined) && checkFillGrant(grant, check).ok;
}

function termsHashOf(authorization: SignAuthorization): string {
  return authorization.kind === "confirmation"
    ? authorization.termsHash
    : authorization.grant.termsHash;
}

/**
 * Rule 5: the transaction pays at most the chain's network fee cap per gas (decision 0143),
 * `termsHash` is the authorization's, and the authorization holds now: a confirmation of this
 * intent that has not expired, or expired less than a minute ago for a cancel (decision 0116); the
 * fill grant of an auto order's or a webhook rule's fill for this intent, its source still active
 * as the owner confirmed it, with no fill recorded since, for a transaction that spends at most
 * the fill's size (decisions 0210 and 0338); or the agent's auto grant for this intent,
 * unexpired, with the agent's mode still auto at the grant's version, for a transaction that
 * passes the auto test's checks.
 */
export function authorizationHolds(view: RuleView): boolean {
  const { authorization, intent } = view.input;
  if (!isFeeUnderCap(view) || termsHashOf(authorization) !== view.input.termsHash) {
    return false;
  }
  if (authorization.kind === "confirmation") {
    const { expiresAtMs } = authorization;
    const isLive = view.nowMs < expiresAtMs || isCancelInGrace(view, expiresAtMs);
    return authorization.intent === intent && isLive;
  }
  return authorization.kind === "approvalMode"
    ? autoHolds(view, authorization.grant, authorization.current)
    : fillHolds(view, authorization.grant, authorization.current);
}
