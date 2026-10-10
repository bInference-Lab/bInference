import { authorizationPayload } from "@binference/chain";
import type { HttpRequest, HttpResponse, JsonValue } from "@binference/core";
import { z } from "zod";
import { quorumSigned } from "./fake-authorization.js";
import { answer, failure, walletJson } from "./fake-privy-answers.js";
import { expired, signaturesOf, signedHeaders } from "./fake-privy-rpc.js";
import type { FakePrivyState, FakeWallet } from "./fake-privy-state.js";

// A wallet update that changes only the added signers, the one update binference sends.
const signersBodySchema = z.strictObject({
  additional_signers: z.array(
    z.strictObject({
      signer_id: z.string().min(1),
      override_policy_ids: z.array(z.string().min(1)).max(1).optional(),
    }),
  ),
});

// Only the wallet's owner updates it; a wallet with no owner takes the app secret alone.
function ownerSigned(
  state: FakePrivyState,
  wallet: FakeWallet,
  signed: { readonly request: HttpRequest; readonly body: JsonValue },
): boolean {
  if (wallet.ownerId === null) {
    return true;
  }
  const owner = state.quorums.get(wallet.ownerId);
  const payload = authorizationPayload({
    method: "PATCH",
    url: signed.request.url,
    body: signed.body,
    headers: signedHeaders(signed.request),
  });
  return owner !== undefined && quorumSigned(owner, payload, signaturesOf(signed.request));
}

/**
 * Answers `PATCH /v1/wallets/<wallet>` with added signers as Privy's wallet update does: the
 * wallet must exist, every signer must be a key quorum and every override a policy the app holds,
 * the expiry must not have passed, and the wallet's owner must have signed the RFC 8785 payload;
 * an added signer's signature changes nothing. The signers given replace every one the wallet had,
 * so a signer left out signs nothing from then on.
 */
export function answerSignersChange(
  state: FakePrivyState,
  request: HttpRequest,
  ids: { readonly wallet: string; readonly body: JsonValue },
): HttpResponse {
  const wallet = state.wallets.get(ids.wallet);
  if (wallet === undefined) {
    return failure(404, "not_found", "Wallet not found.");
  }
  const parsed = signersBodySchema.safeParse(ids.body);
  const signers = parsed.data?.additional_signers ?? [];
  const known = signers.every(
    (item) =>
      state.quorums.has(item.signer_id) &&
      (item.override_policy_ids ?? []).every((id) => state.policies.has(id)),
  );
  if (!parsed.success || !known) {
    return failure(400, "invalid_data", "The request body does not match the schema.");
  }
  if (expired(state, signedHeaders(request))) {
    return failure(400, "request_expired", "The request has expired.");
  }
  if (!ownerSigned(state, wallet, { request, body: ids.body })) {
    return signaturesOf(request).length === 0
      ? failure(401, "missing_or_empty_authorization_header", "No authorization signature.")
      : failure(401, "zero_correct_authorization_signatures", "No valid authorization signature.");
  }
  const changed: FakeWallet = {
    ...wallet,
    signers: signers.map((item) => ({
      signerId: item.signer_id,
      overridePolicyIds: item.override_policy_ids,
    })),
  };
  state.wallets.set(wallet.id, changed);
  return answer(200, walletJson(changed));
}

const walletPath = /^\/v1\/wallets\/([^/]+)$/;

/** The wallet a `PATCH` of a wallet names, or undefined for any other request. */
export function signersChangeOf(request: HttpRequest, path: string): string | undefined {
  const found = walletPath.exec(path);
  return found === null || request.method !== "PATCH" ? undefined : found[1];
}
