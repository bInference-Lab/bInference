import { authorizationPayload } from "@binference/chain";
import type { HttpRequest, HttpResponse, JsonValue } from "@binference/core";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { z } from "zod";
import { quorumSigned } from "./fake-authorization.js";
import { evaluatePolicy } from "./fake-policy-engine.js";
import { answer, failure } from "./fake-privy-answers.js";
import { expired, signaturesOf, signedHeaders } from "./fake-privy-rpc.js";
import type { FakePrivyState, FakeWallet } from "./fake-privy-state.js";

const exportBodySchema = z.strictObject({
  encryption_type: z.literal("HPKE"),
  recipient_public_key: z.base64().min(1),
  export_seed_phrase: z.boolean().exactOptional(),
});

// Privy's export suite: DHKEM P-256 with HKDF-SHA256, HKDF-SHA256, ChaCha20-Poly1305.
const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

// Seals the key's text to a P-256 public key given as DER SubjectPublicKeyInfo in base64; a key
// that is no such key seals nothing.
async function sealed(recipient: string, text: string): Promise<JsonValue | undefined> {
  try {
    const recipientPublicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      Buffer.from(recipient, "base64"),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );
    const sender = await suite.createSenderContext({ recipientPublicKey });
    const ciphertext = await sender.seal(new TextEncoder().encode(text));
    return {
      encryption_type: "HPKE",
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      encapsulated_key: Buffer.from(sender.enc).toString("base64"),
    };
  } catch {
    return undefined;
  }
}

// Only the wallet's owner exports it; Privy exports no wallet without one.
function ownerSigned(
  state: FakePrivyState,
  wallet: FakeWallet,
  signed: { readonly request: HttpRequest; readonly body: JsonValue },
): boolean {
  const owner = wallet.ownerId === null ? undefined : state.quorums.get(wallet.ownerId);
  const payload = authorizationPayload({
    method: "POST",
    url: signed.request.url,
    body: signed.body,
    headers: signedHeaders(signed.request),
  });
  return owner !== undefined && quorumSigned(owner, payload, signaturesOf(signed.request));
}

// Privy exports a wallet under a policy only when each of its policies allows `exportPrivateKey`.
function policiesAllowExport(state: FakePrivyState, wallet: FakeWallet): boolean {
  const input = {
    method: "exportPrivateKey",
    to: wallet.address,
    valueWei: 0n,
    chainId: 0n,
    data: "0x" as const,
    walletAddress: wallet.address,
  };
  return wallet.policyIds.every((id) => {
    const policy = state.policies.get(id);
    return policy !== undefined && evaluatePolicy(policy.rules, input) === "ALLOW";
  });
}

/**
 * Answers `POST /v1/wallets/<wallet>/export` as Privy's export API does: the wallet must exist,
 * the body must ask for HPKE with a recipient key, the expiry must not have passed, and the
 * wallet's owner must have signed the RFC 8785 payload, and each policy of the wallet must allow
 * `exportPrivateKey` (`policy_violation` otherwise). It answers the wallet's private key, as
 * hex text, sealed with HPKE (DHKEM P-256, HKDF-SHA256, ChaCha20-Poly1305) to the recipient key;
 * a recipient key that is no P-256 key is `invalid_data`.
 */
export async function answerExport(
  state: FakePrivyState,
  request: HttpRequest,
  ids: { readonly wallet: string; readonly body: JsonValue },
): Promise<HttpResponse> {
  const wallet = state.wallets.get(ids.wallet);
  if (wallet === undefined) {
    return failure(404, "not_found", "Wallet not found.");
  }
  const parsed = exportBodySchema.safeParse(ids.body);
  if (!parsed.success || parsed.data.export_seed_phrase === true) {
    return failure(400, "invalid_data", "The request body does not match the schema.");
  }
  if (expired(state, signedHeaders(request))) {
    return failure(400, "request_expired", "The request has expired.");
  }
  if (!ownerSigned(state, wallet, { request, body: ids.body })) {
    const none = signaturesOf(request).length === 0;
    return none
      ? failure(401, "missing_or_empty_authorization_header", "No authorization signature.")
      : failure(401, "zero_correct_authorization_signatures", "No valid authorization signature.");
  }
  if (!policiesAllowExport(state, wallet)) {
    return failure(400, "policy_violation", "Policy violation: the request is denied.");
  }
  const body = await sealed(parsed.data.recipient_public_key, wallet.privateKey);
  return body === undefined
    ? failure(400, "invalid_data", "The recipient public key is invalid.")
    : answer(200, body);
}

const exportPath = /^\/v1\/wallets\/([^/]+)\/export$/;

/** The wallet a `POST` of an export names, or undefined for any other request. */
export function exportOf(request: HttpRequest, path: string): string | undefined {
  const found = exportPath.exec(path);
  return found === null || request.method !== "POST" ? undefined : found[1];
}
