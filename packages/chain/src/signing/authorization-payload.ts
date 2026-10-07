import { type JsonValue, stableJson } from "@binference/core";
import type { PrivyHeaders, PrivyRequest } from "./privy-request.js";

/** The version of Privy's authorization signature payload; Privy knows no other. */
const payloadVersion = 1;

// The headers Privy signs, each only when the request has it.
function headersOf(headers: PrivyHeaders): JsonValue {
  const { "privy-idempotency-key": idempotencyKey, "privy-request-expiry": expiry } = headers;
  return {
    "privy-app-id": headers["privy-app-id"],
    ...(idempotencyKey === undefined ? {} : { "privy-idempotency-key": idempotencyKey }),
    ...(expiry === undefined ? {} : { "privy-request-expiry": expiry }),
  };
}

// Privy's SDK signs an empty body, an object or an array with nothing in it, as the empty string;
// Privy checks the same bytes.
function bodyOf(request: PrivyRequest): JsonValue {
  const { body } = request;
  const isEmpty = typeof body === "object" && body !== null && Object.keys(body).length === 0;
  return isEmpty ? "" : body;
}

/**
 * The bytes Privy's authorization signature covers: the JSON of `{ version: 1, method, url, body,
 * headers }` in RFC 8785 canonical form (keys sorted by UTF-16 code units, no spaces), as UTF-8,
 * with an empty object or array body written as `""`. Privy's docs, "Implementing signing directly",
 * define it, and the bytes are those of `formatRequestForAuthorizationSignature` in Privy's Node
 * SDK, which the signer's tests compare them with. The signer signs these bytes, and custody checks
 * the bytes the SDK hands its sign function against them.
 */
export function authorizationPayload(request: PrivyRequest): Buffer {
  const payload = {
    version: payloadVersion,
    method: request.method,
    url: request.url,
    body: bodyOf(request),
    headers: headersOf(request.headers),
  };
  return Buffer.from(stableJson(payload), "utf8");
}
