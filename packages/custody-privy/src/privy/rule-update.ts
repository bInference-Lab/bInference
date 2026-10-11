import type { PrivyRequest } from "@binference/chain";
import { ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { PolicyRuleResponse } from "@privy-io/node/resources";
import { type PolicyRule, policyRuleJson } from "../ceiling/policy-rule.js";
import { callAsOwner, ownerOutcome, ownerSignFn } from "./owner-signing.js";
import type { PrivyCall } from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import type { PrivyId } from "./privy-records.js";
import { readRuleAnswer } from "./privy-wire.schema.js";
import { sdkRule } from "./sdk-rule.js";

/** One rule of a policy to write over, and the time by which Privy must handle the change. */
export interface RuleChange {
  readonly policy: PrivyId;
  readonly rule: PrivyId;
  readonly body: PolicyRule;
  /** Unix milliseconds; Privy refuses the change once this has passed. */
  readonly expiresAtMs: number;
}

/**
 * Who authorizes a rule change: the policy's owner signs the request now, or a signature the owner
 * made earlier over the same request goes with it.
 */
export type RuleAuthorization =
  | {
      readonly kind: "sign";
      /** Signs the exact request, or refuses it; a refusal stops the call before Privy hears it. */
      readonly authorize: (
        request: PrivyRequest,
        signal: AbortSignal,
      ) => Promise<Result<string, "refused">>;
    }
  | { readonly kind: "signed"; readonly signature: string };

/** Why Privy did not change a rule. */
export type RuleRefusal =
  /** The owner did not sign, or Privy did not accept the signature as the policy owner's. */
  | "refused"
  /** The request's expiry had passed when Privy read it. */
  | "expired"
  /** Privy holds no such policy or rule. */
  | "not_found";

/**
 * The request a rule change sends, as its authorization signature covers it: a `PATCH` of the rule
 * with its name, method, conditions and action, and the app id and expiry headers. Privy's SDK
 * forms the same request, so a signature made over this one holds when the SDK sends it.
 */
export function ruleChangeRequest(settings: PrivySettings, change: RuleChange): PrivyRequest {
  return {
    method: "PATCH",
    url: `${settings.origin}/v1/policies/${change.policy}/rules/${change.rule}`,
    headers: {
      "privy-app-id": settings.appId,
      "privy-request-expiry": String(change.expiresAtMs),
    },
    body: policyRuleJson(change.body),
  };
}

function changeCall(
  settings: PrivySettings,
  change: RuleChange,
  authorization: RuleAuthorization,
): PrivyCall<PolicyRuleResponse> {
  return {
    kind: "write",
    path: `/v1/policies/${change.policy}/rules/${change.rule}`,
    run: async (client: PrivyClient, signal: AbortSignal) =>
      client.policies().updateRule(change.rule, {
        ...sdkRule(change.body),
        policy_id: change.policy,
        request_expiry: change.expiresAtMs,
        authorization_context:
          authorization.kind === "signed"
            ? { signatures: [authorization.signature] }
            : {
                sign_fns: [
                  ownerSignFn({
                    meant: ruleChangeRequest(settings, change),
                    authorize: authorization.authorize,
                    signal,
                  }),
                ],
              },
      }),
  };
}

/**
 * What a rule call Privy answered gives, as {@link ownerOutcome} reads it: nothing once `isAnswer`
 * reads Privy's answer.
 */
export async function ruleOutcome<T>(
  call: PrivyCall<T>,
  outcome: Awaited<ReturnType<typeof callAsOwner<T>>>,
  isAnswer: (answer: T) => boolean,
): Promise<Result<void, RuleRefusal>> {
  const read = await ownerOutcome(call, outcome, (answer) => (isAnswer(answer) ? true : undefined));
  return read.ok ? ok(undefined) : read;
}

/**
 * Writes one rule of a policy over, once, as its owner authorizes. Privy's documented refusals
 * become outcomes: a missing or wrong owner signature `refused`, a passed expiry `expired`, an
 * unknown policy or rule `not_found`. A busy app, bad credentials, a refused body or a failing
 * Privy throw, and a call with no answer throws `custody.privy_unreachable`, whose outcome is
 * unknown; changing the rule again with the same body is safe.
 */
export async function changeRule(
  settings: PrivySettings,
  change: RuleChange,
  input: { readonly authorization: RuleAuthorization; readonly signal: AbortSignal },
): Promise<Result<void, RuleRefusal>> {
  const call = changeCall(settings, change, input.authorization);
  return ruleOutcome(call, await callAsOwner(settings, call, input.signal), readRuleAnswer);
}
