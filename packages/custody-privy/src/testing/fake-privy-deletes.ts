import type { HttpRequest, HttpResponse } from "@binference/core";
import { answer, failure } from "./fake-privy-answers.js";
import { unsignedByOwner } from "./fake-privy-rules.js";
import type { FakePrivyState } from "./fake-privy-state.js";

const policyPath = /^\/v1\/policies\/([^/]+)$/;
const quorumPath = /^\/v1\/key_quorums\/([^/]+)$/;

// Whether a wallet holds the policy, as its own or as an added signer's override.
function isAttached(state: FakePrivyState, policy: string): boolean {
  return [...state.wallets.values()].some(
    (wallet) =>
      wallet.policyIds.includes(policy) ||
      wallet.signers.some((signer) => signer.overridePolicyIds?.includes(policy) === true),
  );
}

// Whether the quorum owns a wallet, a policy or an aggregation, or signs for a wallet.
function isInUse(state: FakePrivyState, quorum: string): boolean {
  const owners = [...state.wallets.values(), ...state.policies.values()].map(
    (held) => held.ownerId,
  );
  const aggregationOwners = [...state.aggregations.values()].map((held) => held.ownerId);
  const signers = [...state.wallets.values()].flatMap((wallet) =>
    wallet.signers.map((signer) => signer.signerId),
  );
  return [...owners, ...aggregationOwners, ...signers].includes(quorum);
}

/**
 * Answers `DELETE /v1/policies/<policy>`: the policy must exist, its owner must sign the request
 * with an empty body, and no wallet may still hold it, as its own policy or a signer's override;
 * one still held is a 409, as the fake assumes Privy answers it.
 */
function answerPolicyDelete(state: FakePrivyState, request: HttpRequest, id: string): HttpResponse {
  const policy = state.policies.get(id);
  if (policy === undefined) {
    return failure(404, "not_found", "Policy not found.");
  }
  const refused = unsignedByOwner(state, policy.ownerId, { request, body: {} });
  if (refused !== undefined) {
    return refused;
  }
  if (isAttached(state, id)) {
    return failure(409, "conflict", "A wallet still holds the policy.");
  }
  state.policies.delete(id);
  return answer(200, { success: true });
}

/**
 * Answers `DELETE /v1/key_quorums/<quorum>`: the quorum must exist and sign its own delete with an
 * empty body, and it must own and sign for nothing; one still in use is a 409, as the fake assumes
 * Privy answers it.
 */
function answerQuorumDelete(state: FakePrivyState, request: HttpRequest, id: string): HttpResponse {
  if (!state.quorums.has(id)) {
    return failure(404, "not_found", "Key quorum not found.");
  }
  const refused = unsignedByOwner(state, id, { request, body: {} });
  if (refused !== undefined) {
    return refused;
  }
  if (isInUse(state, id)) {
    return failure(409, "conflict", "The key quorum still owns or signs for a resource.");
  }
  state.quorums.delete(id);
  return answer(200, { success: true });
}

/** Answers a `DELETE` of a policy or a key quorum; undefined for any other request. */
export function answerResourceDelete(
  state: FakePrivyState,
  request: HttpRequest,
  path: string,
): HttpResponse | undefined {
  if (request.method !== "DELETE") {
    return undefined;
  }
  const policy = policyPath.exec(path)?.[1];
  if (policy !== undefined) {
    return answerPolicyDelete(state, request, policy);
  }
  const quorum = quorumPath.exec(path)?.[1];
  return quorum === undefined ? undefined : answerQuorumDelete(state, request, quorum);
}
