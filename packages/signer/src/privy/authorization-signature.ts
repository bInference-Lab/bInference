import { type KeyObject, sign } from "node:crypto";
import { authorizationPayload, type PrivyRequest } from "@binference/chain";

/**
 * Privy's authorization signature over a request: ECDSA on P-256 over the SHA-256 of
 * `authorizationPayload` (from `@binference/chain`), DER-encoded, in base64. It goes in the
 * request's `privy-authorization-signature` header.
 */
export function signAuthorization(privateKey: KeyObject, request: PrivyRequest): string {
  return sign("sha256", authorizationPayload(request), privateKey).toString("base64");
}
