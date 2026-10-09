import { authorizationPayload, type PrivyRequest } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { PolicyRuleResponse } from "@privy-io/node/resources";
import { type PolicyRule, policyRuleJson } from "../ceiling/policy-rule.js";
import {
  callPrivy,
  type PrivyCall,
  type PrivyOutcome,
  privyFault,
  statusFault,
} from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import type { PrivyId } from "./privy-records.js";
import { readRuleAnswer, refusalOf } from "./privy-wire.schema.js";
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

// Never leaves this file: a refusal of the signer stops the SDK before it sends anything.
const ownerRefused = "custody.owner_refused";

/** One signing of a rule change: the request meant, and the bytes the SDK asks to sign. */
interface Signing {
  readonly meant: PrivyRequest;
  readonly authorize: Extract<RuleAuthorization, { readonly kind: "sign" }>["authorize"];
  readonly payload: Uint8Array;
  readonly signal: AbortSignal;
}

// The owner signs only the request this adapter means to send: the SDK's bytes must be its own.
async function signedBy({ meant, authorize, payload, signal }: Signing): Promise<string> {
  if (!authorizationPayload(meant).equals(payload)) {
    throw new BinferenceError({
      code: "custody.payload_unreadable",
      message: "The SDK asked to sign a rule change other than the one this adapter sends.",
    });
  }
  const answer = await authorize(meant, signal);
  if (!answer.ok) {
    throw new BinferenceError({ code: ownerRefused, message: "The owner refused." });
  }
  return answer.value;
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
                  async (payload) =>
                    signedBy({
                      meant: ruleChangeRequest(settings, change),
                      authorize: authorization.authorize,
                      payload,
                      signal,
                    }),
                ],
              },
      }),
  };
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
  let outcome: PrivyOutcome<PolicyRuleResponse>;
  try {
    outcome = await callPrivy(settings, call, input.signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === ownerRefused) {
      return err("refused");
    }
    throw error;
  }
  if (outcome.ok) {
    return readRuleAnswer(outcome.value)
      ? ok(undefined)
      : Promise.reject(privyFault("custody.privy_malformed", call));
  }
  const refusal = refusalOf(outcome.code);
  if (refusal === "authorization") {
    return err("refused");
  }
  if (refusal === "expired") {
    return err("expired");
  }
  return outcome.status === 404 ? err("not_found") : Promise.reject(statusFault(call, outcome));
}
