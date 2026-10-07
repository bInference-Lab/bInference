import {
  type AdvanceAuthorization,
  type ApprovalModeNow,
  type AutoModeGrant,
  checkAutoModeGrant,
  type SignAuthorization,
} from "@binference/chain";
import type { RuleView } from "./hard-rule.js";

function advanceHolds(authorization: AdvanceAuthorization, nowMs: number): boolean {
  const { expiresAtMs, maxFills } = authorization;
  return (
    authorization.state === "active" &&
    (expiresAtMs === undefined || nowMs < expiresAtMs) &&
    (maxFills === undefined || authorization.fills < maxFills)
  );
}

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

const termsHashOf = (authorization: SignAuthorization): string =>
  authorization.kind === "approvalMode" ? authorization.grant.termsHash : authorization.termsHash;

/**
 * Rule 5: `termsHash` is the authorization's, and the authorization holds now: a confirmation of
 * this intent that has not expired; an active auto order or webhook rule within its expiry and
 * its fills; or the agent's auto grant for this intent, unexpired, with the agent's mode still
 * auto at the grant's version, for a transaction that passes the auto test's checks.
 */
export function authorizationHolds(view: RuleView): boolean {
  const { authorization, intent } = view.input;
  if (termsHashOf(authorization) !== view.input.termsHash) {
    return false;
  }
  if (authorization.kind === "confirmation") {
    return authorization.intent === intent && view.nowMs < authorization.expiresAtMs;
  }
  if (authorization.kind === "approvalMode") {
    return autoHolds(view, authorization.grant, authorization.current);
  }
  return advanceHolds(authorization, view.nowMs);
}
