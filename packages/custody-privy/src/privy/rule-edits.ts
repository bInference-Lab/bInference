import type { PrivyRequest } from "@binference/chain";
import type { Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import { type PolicyRule, policyRuleJson } from "../ceiling/policy-rule.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";
import { callAsOwner, ownerSignFn } from "./owner-signing.js";
import type { PrivySettings } from "./privy-client.js";
import type { PrivyId } from "./privy-records.js";
import { readRuleAnswer, readSuccess } from "./privy-wire.schema.js";
import { type RuleRefusal, ruleOutcome } from "./rule-update.js";
import { sdkRule } from "./sdk-rule.js";

/** A rule to add to a policy, by the time Privy must handle the request. */
export interface RuleAddition {
  readonly policy: PrivyId;
  readonly body: PolicyRule;
  /** Unix milliseconds; Privy refuses the request once this has passed. */
  readonly expiresAtMs: number;
}

/** A rule to take out of a policy, by the time Privy must handle the request. */
export interface RuleRemoval {
  readonly policy: PrivyId;
  readonly rule: PrivyId;
  readonly expiresAtMs: number;
}

function headersOf(settings: PrivySettings, expiresAtMs: number) {
  return { "privy-app-id": settings.appId, "privy-request-expiry": String(expiresAtMs) };
}

/** The request adding a rule sends, as the owner's signature covers it. */
function additionRequest(settings: PrivySettings, addition: RuleAddition): PrivyRequest {
  return {
    method: "POST",
    url: `${settings.origin}/v1/policies/${addition.policy}/rules`,
    headers: headersOf(settings, addition.expiresAtMs),
    body: policyRuleJson(addition.body),
  };
}

/** The request removing a rule sends, as the owner's signature covers it: an empty body. */
function removalRequest(settings: PrivySettings, removal: RuleRemoval): PrivyRequest {
  return {
    method: "DELETE",
    url: `${settings.origin}/v1/policies/${removal.policy}/rules/${removal.rule}`,
    headers: headersOf(settings, removal.expiresAtMs),
    body: {},
  };
}

/**
 * Adds one rule to a policy, once, signed now by the policy's owner, through the SDK's
 * `createRule`. Outcomes as for a rule change: `refused`, `expired`, `not_found`; a call with no
 * answer throws `custody.privy_unreachable`, whose outcome is unknown.
 */
export async function addRule(
  settings: PrivySettings,
  addition: RuleAddition,
  input: { readonly authorize: OwnerAuthorize; readonly signal: AbortSignal },
): Promise<Result<void, RuleRefusal>> {
  const meant = additionRequest(settings, addition);
  const call = {
    kind: "write" as const,
    path: `/v1/policies/${addition.policy}/rules`,
    run: async (client: PrivyClient, signal: AbortSignal) =>
      client.policies().createRule(addition.policy, {
        ...sdkRule(addition.body),
        request_expiry: addition.expiresAtMs,
        authorization_context: {
          sign_fns: [ownerSignFn({ meant, authorize: input.authorize, signal })],
        },
      }),
  };
  return ruleOutcome(call, await callAsOwner(settings, call, input.signal), readRuleAnswer);
}

/**
 * Takes one rule out of a policy, once, signed now by the policy's owner, through the SDK's
 * `deleteRule`. Outcomes as for a rule change.
 */
export async function removeRule(
  settings: PrivySettings,
  removal: RuleRemoval,
  input: { readonly authorize: OwnerAuthorize; readonly signal: AbortSignal },
): Promise<Result<void, RuleRefusal>> {
  const meant = removalRequest(settings, removal);
  const call = {
    kind: "write" as const,
    path: `/v1/policies/${removal.policy}/rules/${removal.rule}`,
    run: async (client: PrivyClient, signal: AbortSignal) =>
      client.policies().deleteRule(removal.rule, {
        policy_id: removal.policy,
        request_expiry: removal.expiresAtMs,
        authorization_context: {
          sign_fns: [ownerSignFn({ meant, authorize: input.authorize, signal })],
        },
      }),
  };
  return ruleOutcome(call, await callAsOwner(settings, call, input.signal), readSuccess);
}
