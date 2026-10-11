import { authorizationPayload } from "@binference/chain";
import { type HttpRequest, type HttpResponse, type JsonValue } from "@binference/core";
import { quorumSigned } from "./fake-authorization.js";
import { answer, failure, ruleJson } from "./fake-privy-answers.js";
import { fakeRuleSchema } from "./fake-privy-request.schema.js";
import { expired, signaturesOf, signedHeaders } from "./fake-privy-rpc.js";
import { type FakePrivyState, newFakeId } from "./fake-privy-state.js";

// The owner must sign a change of what it owns; a thing with no owner takes the app secret alone.
function ownerSigned(
  state: FakePrivyState,
  ownerId: string | null,
  signed: { readonly request: HttpRequest; readonly body: JsonValue },
): boolean {
  const { request, body } = signed;
  if (ownerId === null) {
    return true;
  }
  const owner = state.quorums.get(ownerId);
  const payload = authorizationPayload({
    method: request.method,
    url: request.url,
    body,
    headers: signedHeaders(request),
  });
  return owner !== undefined && quorumSigned(owner, payload, signaturesOf(request));
}

/**
 * The refusal Privy gives a change whose expiry passed, or that the key quorum owning the changed
 * thing did not sign over the request with this body; undefined when the change may go on. One
 * with no owner takes the app secret alone.
 */
export function unsignedByOwner(
  state: FakePrivyState,
  ownerId: string | null,
  signed: { readonly request: HttpRequest; readonly body: JsonValue },
): HttpResponse | undefined {
  if (expired(state, signedHeaders(signed.request))) {
    return failure(400, "request_expired", "The request has expired.");
  }
  if (ownerSigned(state, ownerId, signed)) {
    return undefined;
  }
  return signaturesOf(signed.request).length === 0
    ? failure(401, "missing_or_empty_authorization_header", "No authorization signature.")
    : failure(401, "zero_correct_authorization_signatures", "No valid authorization signature.");
}

/**
 * Answers `POST /v1/policies/<policy>/rules` as Privy does: the policy must exist, the body must be
 * a rule, the expiry must not have passed, and the policy's owner must have signed the RFC 8785
 * payload. The rule joins the policy with a new id.
 */
export function answerRuleAddition(
  state: FakePrivyState,
  request: HttpRequest,
  target: { readonly policy: string; readonly body: JsonValue },
): HttpResponse {
  const policy = state.policies.get(target.policy);
  if (policy === undefined) {
    return failure(404, "not_found", "Policy not found.");
  }
  const parsed = fakeRuleSchema.safeParse(target.body);
  if (!parsed.success) {
    return failure(400, "invalid_data", "The request body does not match the schema.");
  }
  const refused = unsignedByOwner(state, policy.ownerId, { request, body: target.body });
  if (refused !== undefined) {
    return refused;
  }
  const added = { id: newFakeId(state), ...parsed.data };
  state.policies.set(policy.id, { ...policy, rules: [...policy.rules, added] });
  return answer(200, ruleJson(added));
}

/**
 * Answers `DELETE /v1/policies/<policy>/rules/<rule>` as Privy does: the policy and the rule must
 * exist, the expiry must not have passed, and the policy's owner must have signed the payload of
 * the request with an empty body, as Privy's SDK forms it.
 */
export function answerRuleRemoval(
  state: FakePrivyState,
  request: HttpRequest,
  ids: { readonly policy: string; readonly rule: string },
): HttpResponse {
  const policy = state.policies.get(ids.policy);
  if (policy === undefined || !policy.rules.some((rule) => rule.id === ids.rule)) {
    return failure(404, "not_found", "Policy or rule not found.");
  }
  const refused = unsignedByOwner(state, policy.ownerId, { request, body: {} });
  if (refused !== undefined) {
    return refused;
  }
  const rules = policy.rules.filter((rule) => rule.id !== ids.rule);
  state.policies.set(policy.id, { ...policy, rules });
  return answer(200, { success: true });
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
  const refused = unsignedByOwner(state, policy.ownerId, { request, body: ids.body });
  if (refused !== undefined) {
    return refused;
  }
  const changed = { id: ids.rule, ...parsed.data };
  const rules = policy.rules.map((rule) => (rule.id === ids.rule ? changed : rule));
  state.policies.set(policy.id, { ...policy, rules });
  return answer(200, ruleJson(changed));
}

const rulePath = /^\/v1\/policies\/([^/]+)\/rules\/([^/]+)$/;
const rulesPath = /^\/v1\/policies\/([^/]+)\/rules$/;

/** The policy and rule a request names, by its method; undefined for another request. */
export function ruleChangeOf(
  request: HttpRequest,
  path: string,
  method: "PATCH" | "DELETE" = "PATCH",
): { readonly policy: string; readonly rule: string } | undefined {
  const found = rulePath.exec(path);
  return found === null || request.method !== method
    ? undefined
    : { policy: found[1] ?? "", rule: found[2] ?? "" };
}

/** The policy a `POST` of a new rule names; undefined for another request. */
export function ruleAdditionOf(request: HttpRequest, path: string): string | undefined {
  const found = rulesPath.exec(path)?.[1];
  return request.method === "POST" ? found : undefined;
}
