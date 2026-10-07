import { createPublicKey } from "node:crypto";
import type { HttpResponse, JsonValue } from "@binference/core";
import { privateKeyToAccount } from "viem/accounts";
import { answer, failure, policyJson, quorumJson, walletJson } from "./fake-privy-answers.js";
import {
  fakeKeyQuorumBodySchema,
  fakePolicyBodySchema,
  fakeWalletBodySchema,
  type FakeWalletBody,
} from "./fake-privy-request.schema.js";
import { type FakePrivyState, maxHeld, newFakeId, newPrivateKey } from "./fake-privy-state.js";

const invalid = (): HttpResponse =>
  failure(400, "invalid_data", "The request body does not match the schema.");

const full = (): HttpResponse => failure(400, "limit_reached", "The fake holds no more of these.");

function isP256Key(text: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(text, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

/** Answers `POST /v1/key_quorums`: P-256 keys only, and a threshold no higher than the keys. */
export function createQuorum(state: FakePrivyState, body: JsonValue): HttpResponse {
  if (state.quorums.size >= maxHeld) {
    return full();
  }
  const parsed = fakeKeyQuorumBodySchema.safeParse(body);
  if (!parsed.success || !parsed.data.public_keys.every(isP256Key)) {
    return invalid();
  }
  const { public_keys: publicKeys, authorization_threshold: threshold = 1 } = parsed.data;
  if (threshold > publicKeys.length) {
    return invalid();
  }
  const quorum = {
    id: newFakeId(state),
    publicKeys,
    threshold,
    displayName: parsed.data.display_name ?? null,
  };
  state.quorums.set(quorum.id, quorum);
  return answer(200, quorumJson(quorum));
}

/** Answers `POST /v1/policies`: an owner, when named, must be a key quorum the app holds. */
export function createPolicy(state: FakePrivyState, body: JsonValue): HttpResponse {
  if (state.policies.size >= maxHeld) {
    return full();
  }
  const parsed = fakePolicyBodySchema.safeParse(body);
  const ownerId = parsed.data?.owner_id ?? null;
  if (!parsed.success || (ownerId !== null && !state.quorums.has(ownerId))) {
    return invalid();
  }
  const policy = {
    id: newFakeId(state),
    name: parsed.data.name,
    ownerId,
    rules: parsed.data.rules.map((rule) => ({
      id: newFakeId(state),
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions,
    })),
    createdAt: state.clock.now(),
  };
  state.policies.set(policy.id, policy);
  return answer(200, policyJson(policy));
}

function knowsEveryId(state: FakePrivyState, body: FakeWalletBody): boolean {
  const signers = body.additional_signers ?? [];
  const policyIds = [
    ...(body.policy_ids ?? []),
    ...signers.flatMap((item) => item.override_policy_ids ?? []),
  ];
  const quorumIds = [
    ...signers.map((item) => item.signer_id),
    ...(body.owner_id ? [body.owner_id] : []),
  ];
  return (
    policyIds.every((id) => state.policies.has(id)) &&
    quorumIds.every((id) => state.quorums.has(id))
  );
}

/** Answers `POST /v1/wallets`: every quorum and policy it names must exist. */
export function createWallet(state: FakePrivyState, body: JsonValue): HttpResponse {
  if (state.wallets.size >= maxHeld) {
    return full();
  }
  const parsed = fakeWalletBodySchema.safeParse(body);
  if (!parsed.success || !knowsEveryId(state, parsed.data)) {
    return invalid();
  }
  const privateKey = newPrivateKey(state);
  const wallet = {
    id: newFakeId(state),
    address: privateKeyToAccount(privateKey).address,
    privateKey,
    ownerId: parsed.data.owner_id ?? null,
    policyIds: parsed.data.policy_ids ?? [],
    signers: (parsed.data.additional_signers ?? []).map((item) => ({
      signerId: item.signer_id,
      overridePolicyIds: item.override_policy_ids,
    })),
    createdAt: state.clock.now(),
  };
  state.wallets.set(wallet.id, wallet);
  return answer(200, walletJson(wallet));
}
