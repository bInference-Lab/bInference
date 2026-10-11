import { Buffer } from "node:buffer";
import { sign } from "node:crypto";
import type { WebPushKey } from "./web-push-key.js";

/**
 * The `sub` claim: a contact for the push service's operator, which Apple's service requires. It
 * names the project, never a person (decision 0158).
 */
const contact = "https://binference.io";
// RFC 8292 allows at most 24 hours; 12 leaves room for a clock that runs fast.
const tokenLifetimeSec = 12 * 60 * 60;

function encodePart(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * The `Authorization` header of a push request to the endpoint (RFC 8292): `vapid t=<JWT>,
 * k=<public key>`, where the JWT is ES256 over the endpoint's origin as `aud`, an `exp` 12 hours
 * after `nowMs` and the project's `sub`.
 */
export function vapidAuthorization(endpoint: string, key: WebPushKey, nowMs: number): string {
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + tokenLifetimeSec,
    sub: contact,
  };
  const signed = `${encodePart({ typ: "JWT", alg: "ES256" })}.${encodePart(claims)}`;
  const signature = sign("sha256", Buffer.from(signed, "utf8"), {
    key: key.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signed}.${signature.toString("base64url")}, k=${key.publicKey}`;
}
