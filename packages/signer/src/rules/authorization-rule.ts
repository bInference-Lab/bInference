import type { ApprovalModeNow, AutoModeGrant } from "../requests/auto-mode-grant.schema.js";
import type {
  AdvanceAuthorization,
  SignerAuthorization,
} from "../requests/signer-authorization.schema.js";
import type { RuleView } from "./hard-rule.js";

function advanceHolds(authorization: AdvanceAuthorization, nowMs: number): boolean {
  const { expiresAtMs, maxFills } = authorization;
  return (
    authorization.state === "active" &&
    (expiresAtMs === undefined || nowMs < expiresAtMs) &&
    (maxFills === undefined || authorization.fills < maxFills)
  );
}

// The auto test's parts the transaction shows (intent-states spec, section 5): never a send, and
// a fee per gas at most the network fee cap. A cancel moves nothing, so its fee needs no cap.
function autoTestHolds(view: RuleView, networkFeeCap: bigint): boolean {
  const { step } = view.input;
  if (step.replaces?.kind === "cancel") {
    return true;
  }
  const fee = view.transaction.feePerGas;
  return step.action.kind !== "send" && fee !== undefined && fee <= networkFeeCap;
}

function autoHolds(view: RuleView, grant: AutoModeGrant, current: ApprovalModeNow): boolean {
  return (
    grant.intent === view.input.intent &&
    current.agent === grant.agent &&
    current.mode === "auto" &&
    current.version === grant.modeVersion &&
    view.nowMs < grant.expiresAtMs &&
    autoTestHolds(view, grant.networkFeeCapNativeBase)
  );
}

const termsHashOf = (authorization: SignerAuthorization): string =>
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
