import {
  type HttpRequest,
  type HttpResponse,
  type JsonValue,
  jsonValueSchema,
} from "@binference/core";
import { hexToBigInt, hexToNumber } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signaturePayload } from "../signer-process/privy-request.js";
import { authorizingParty, type FakeParty } from "./fake-authorization.js";
import { evaluatePolicy } from "./fake-policy-engine.js";
import { answer, failure } from "./fake-privy-answers.js";
import {
  type FakeQuantity,
  type FakeTransaction,
  fakeSignBodySchema,
  parseJsonText,
} from "./fake-privy-request.schema.js";
import type { FakePrivyState, FakeWallet } from "./fake-privy-state.js";

const signatureHeader = "privy-authorization-signature";

function bigOf(quantity: FakeQuantity): bigint {
  return typeof quantity === "number" ? BigInt(quantity) : hexToBigInt(quantity);
}

function smallOf(quantity: FakeQuantity): number {
  return typeof quantity === "number" ? quantity : hexToNumber(quantity);
}

// The `privy-` headers a signature covers: every one the request carries but the signature itself.
function signedHeaders(request: HttpRequest): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(
      ([name]) => name.startsWith("privy-") && name !== signatureHeader,
    ),
  );
}

function policiesFor(wallet: FakeWallet, party: FakeParty): readonly string[] {
  return party.kind === "signer" && party.signer.overridePolicyIds !== undefined
    ? party.signer.overridePolicyIds
    : wallet.policyIds;
}

function allowed(
  state: FakePrivyState,
  wallet: FakeWallet,
  input: { readonly party: FakeParty; readonly tx: FakeTransaction },
): boolean {
  const { tx } = input;
  const policyInput = {
    method: "eth_signTransaction",
    to: tx.to,
    valueWei: bigOf(tx.value ?? 0),
    chainId: bigOf(tx.chain_id),
    data: tx.data ?? "0x",
    walletAddress: wallet.address,
  };
  return policiesFor(wallet, input.party).every((id) => {
    const policy = state.policies.get(id);
    return policy !== undefined && evaluatePolicy(policy.rules, policyInput) === "ALLOW";
  });
}

async function signed(wallet: FakeWallet, tx: FakeTransaction): Promise<string> {
  return privateKeyToAccount(wallet.privateKey).signTransaction({
    type: "eip1559",
    chainId: smallOf(tx.chain_id),
    nonce: smallOf(tx.nonce),
    gas: bigOf(tx.gas_limit),
    maxFeePerGas: bigOf(tx.max_fee_per_gas),
    maxPriorityFeePerGas: bigOf(tx.max_priority_fee_per_gas),
    to: tx.to,
    value: bigOf(tx.value ?? 0),
    data: tx.data ?? "0x",
  });
}

function expired(state: FakePrivyState, headers: Readonly<Record<string, string>>): boolean {
  const expiry = headers["privy-request-expiry"];
  return (
    expiry !== undefined && !(/^\d+$/.test(expiry) && BigInt(expiry) >= BigInt(state.clock.now()))
  );
}

// The party whose signatures over the request's RFC 8785 payload authorize it, or the refusal.
function partyOf(
  state: FakePrivyState,
  wallet: FakeWallet,
  request: { readonly http: HttpRequest; readonly body: JsonValue },
): FakeParty | HttpResponse {
  const headers = signedHeaders(request.http);
  if (expired(state, headers)) {
    return failure(400, "request_expired", "The request has expired.");
  }
  const signatures = (request.http.headers?.[signatureHeader] ?? "")
    .split(",")
    .filter((item) => item !== "");
  const text = signaturePayload({
    method: "POST",
    url: request.http.url,
    body: request.body,
    headers,
  });
  const party = authorizingParty(state, wallet, { payload: Buffer.from(text, "utf8"), signatures });
  if (party !== undefined) {
    return party;
  }
  return signatures.length === 0
    ? failure(401, "missing_or_empty_authorization_header", "No authorization signature.")
    : failure(401, "zero_correct_authorization_signatures", "No valid authorization signature.");
}

/**
 * Answers `POST /v1/wallets/<id>/rpc` with `eth_signTransaction` as Privy does: the body must
 * parse, the expiry must not have passed, the owner or an added signer must have signed the RFC
 * 8785 payload, and every policy that binds that party must allow the transaction. Then the
 * wallet's own key signs it.
 */
export async function answerSignTransaction(
  state: FakePrivyState,
  request: HttpRequest,
  walletId: string,
): Promise<HttpResponse> {
  const wallet = state.wallets.get(walletId);
  if (wallet === undefined) {
    return failure(404, "not_found", "Wallet not found.");
  }
  const json = jsonValueSchema.safeParse(parseJsonText(request.body ?? ""));
  const tx = fakeSignBodySchema.safeParse(json.data);
  if (!json.success || !tx.success) {
    return failure(400, "invalid_data", "The request body does not match the schema.");
  }
  const party = partyOf(state, wallet, { http: request, body: json.data });
  if ("status" in party) {
    return party;
  }
  if (!allowed(state, wallet, { party, tx: tx.data })) {
    return failure(400, "policy_violation", "Policy violation: the request is denied.");
  }
  const raw = await signed(wallet, tx.data);
  return answer(200, {
    method: "eth_signTransaction",
    data: { signed_transaction: raw, encoding: "rlp" },
  });
}
