import type { HttpResponse, JsonValue } from "@binference/core";
import type { FakePolicy, FakeQuorum, FakeWallet } from "./fake-privy-state.js";

/** An answer with a JSON body. */
export function answer(status: number, body: JsonValue): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** An error answer: a message and a code, as the fake assumes Privy writes them. */
export function failure(status: number, code: string, error: string): HttpResponse {
  return answer(status, { error, code });
}

// Privy's own example answers break a public key's base64 into lines of 64, as PEM does.
function wrapped(key: string): string {
  return key.match(/.{1,64}/g)?.join("\n") ?? key;
}

/** A key quorum as Privy answers it. */
export function quorumJson(quorum: FakeQuorum): JsonValue {
  return {
    id: quorum.id,
    display_name: quorum.displayName,
    authorization_threshold: quorum.threshold,
    authorization_keys: quorum.publicKeys.map((key) => ({
      public_key: wrapped(key),
      display_name: null,
    })),
    user_ids: null,
  };
}

/** A policy as Privy answers it. */
export function policyJson(policy: FakePolicy): JsonValue {
  return {
    id: policy.id,
    version: "1.0",
    name: policy.name,
    chain_type: "ethereum",
    owner_id: policy.ownerId,
    created_at: policy.createdAt,
    rules: policy.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions.map((condition) => ({
        field_source: condition.field_source,
        field: condition.field,
        ...(condition.abi === undefined
          ? {}
          : {
              abi: condition.abi.map((item) => ({
                type: item.type,
                name: item.name,
                inputs: item.inputs.map((input) => ({ ...input })),
                outputs: item.outputs.map((output) => ({ ...output })),
                stateMutability: item.stateMutability,
              })),
            }),
        operator: condition.operator,
        value: typeof condition.value === "string" ? condition.value : [...condition.value],
      })),
    })),
  };
}

/** A wallet as Privy answers it. */
export function walletJson(wallet: FakeWallet): JsonValue {
  return {
    id: wallet.id,
    address: wallet.address,
    chain_type: "ethereum",
    owner_id: wallet.ownerId,
    policy_ids: [...wallet.policyIds],
    additional_signers: wallet.signers.map((signer) => ({
      signer_id: signer.signerId,
      ...(signer.overridePolicyIds === undefined
        ? {}
        : { override_policy_ids: [...signer.overridePolicyIds] }),
    })),
    created_at: wallet.createdAt,
    exported_at: null,
    imported_at: null,
  };
}
