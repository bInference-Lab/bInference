import { authorizationPayload } from "@binference/chain";
import { type HttpRequest, type HttpResponse, type JsonValue } from "@binference/core";
import { quorumSigned } from "./fake-authorization.js";
import { answer, failure, ruleJson } from "./fake-privy-answers.js";
import { fakeRuleSchema } from "./fake-privy-request.schema.js";
import { expired, signaturesOf, signedHeaders } from "./fake-privy-rpc.js";
import type { FakePolicy, FakePrivyState } from "./fake-privy-state.js";

// The policy's owner must sign a change of it; a policy with no owner takes the app secret alone.
function ownerSigned(
  state: FakePrivyState,
  policy: FakePolicy,
  signed: { readonly request: HttpRequest; readonly body: JsonValue },
): boolean {
  const { request, body } = signed;
  if (policy.ownerId === null) {
    return true;
  }
  const owner = state.quorums.get(policy.ownerId);
  const payload = authorizationPayload({
    method: "PATCH",
    url: request.url,
    body,
    headers: signedHeaders(request),
  });
  return owner !== undefined && quorumSigned(owner, payload, signaturesOf(request));
}

/**
 * Answers `PATCH /v1/policies/<policy>/rules/<rule>` as Privy does: the policy and the rule must
 * exist, the body must be a rule, the expiry must not have passed, and the policy's owner must have
 * signed the RFC 8785 payload. The rule keeps its id and takes the body's name, method, conditions
 * and action.
 */
export function answerRuleChange(
  state: FakePrivyState,
  request: HttpRequest,
  ids: { readonly policy: string; readonly rule: string; readonly body: JsonValue },
): HttpResponse {
  const policy = state.policies.get(ids.policy);
  if (policy === undefined || !policy.rules.some((rule) => rule.id === ids.rule)) {
    return failure(404, "not_found", "Policy or rule not found.");
  }
  const parsed = fakeRuleSchema.safeParse(ids.body);
  if (!parsed.success) {
    return failure(400, "invalid_data", "The request body does not match the schema.");
  }
  if (expired(state, signedHeaders(request))) {
    return failure(400, "request_expired", "The request has expired.");
  }
  if (!ownerSigned(state, policy, { request, body: ids.body })) {
    const none = signaturesOf(request).length === 0;
    return none
      ? failure(401, "missing_or_empty_authorization_header", "No authorization signature.")
      : failure(401, "zero_correct_authorization_signatures", "No valid authorization signature.");
  }
  const changed = { id: ids.rule, ...parsed.data };
  const rules = policy.rules.map((rule) => (rule.id === ids.rule ? changed : rule));
  state.policies.set(policy.id, { ...policy, rules });
  return answer(200, ruleJson(changed));
}

const rulePath = /^\/v1\/policies\/([^/]+)\/rules\/([^/]+)$/;

/** The policy and rule a `PATCH` names, or undefined for any other request. */
export function ruleChangeOf(
  request: HttpRequest,
  path: string,
): { readonly policy: string; readonly rule: string } | undefined {
  const found = rulePath.exec(path);
  return found === null || request.method !== "PATCH"
    ? undefined
    : { policy: found[1] ?? "", rule: found[2] ?? "" };
}
