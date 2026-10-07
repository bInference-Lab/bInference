import { type JsonValue, stableJson } from "@binference/core";

/**
 * One request to Privy's API, as its authorization signature covers it: the HTTP method, the full
 * URL with no trailing slash, the JSON body and Privy's own `privy-` headers. Basic auth,
 * `content-type` and the signature header itself are not part of it.
 */
export interface PrivyRequest {
  readonly method: "POST";
  readonly url: string;
  readonly body: JsonValue;
  /** `privy-app-id`, and `privy-idempotency-key` and `privy-request-expiry` when the request has them. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The text an authorization signature signs: version 1 of Privy's payload over the request, as
 * RFC 8785 canonical JSON (keys sorted by UTF-16 code units, no spaces, numbers and strings as
 * ECMAScript writes them). The signer signs its UTF-8 bytes with ECDSA P-256 over SHA-256.
 */
export function signaturePayload(request: PrivyRequest): string {
  return stableJson({
    version: 1,
    method: request.method,
    url: request.url,
    body: request.body,
    headers: request.headers,
  });
}
