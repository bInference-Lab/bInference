import { type KeyObject, sign } from "node:crypto";
import { authorizationPayload } from "@binference/chain";
import { ok } from "@binference/core";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";

/**
 * Signs requests as an owner key held in the test: ECDSA P-256 over the SHA-256 of the request's
 * authorization payload, DER in base64, as Privy checks it.
 */
export function ownerSigner(privateKey: KeyObject): OwnerAuthorize {
  return async (request) =>
    Promise.resolve(
      ok(sign("sha256", authorizationPayload(request), privateKey).toString("base64")),
    );
}
