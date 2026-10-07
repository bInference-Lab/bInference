import { type KeyObject, sign } from "node:crypto";
import { type JsonValue, stableJson } from "@binference/core";
import type { PrivyRequest } from "./privy-request.schema.js";

/** The version of Privy's authorization signature payload; Privy knows no other. */
const payloadVersion = 1;

function headersOf(request: PrivyRequest): JsonValue {
  return Object.fromEntries(
    Object.entries(request.headers).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
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
 * SDK, which a test compares them with.
 */
export function authorizationPayload(request: PrivyRequest): Buffer {
  const payload = {
    version: payloadVersion,
    method: request.method,
    url: request.url,
    body: bodyOf(request),
    headers: headersOf(request),
  };
  return Buffer.from(stableJson(payload), "utf8");
}

/**
 * Privy's authorization signature over a request: ECDSA on P-256 over the SHA-256 of
 * {@link authorizationPayload}, DER-encoded, in base64. It goes in the request's
 * `privy-authorization-signature` header.
 */
export function signAuthorization(privateKey: KeyObject, request: PrivyRequest): string {
  return sign("sha256", authorizationPayload(request), privateKey).toString("base64");
}
