import type { ErrorCode } from "@binference/core";
import { sha256Hex } from "@binference/engine";
import type { OpenFrame } from "@binference/protocol";
import { type Link, sayBye } from "./connection-link.js";

// The keys a sign-in's failures count under: where it came from, and the credential it claims.
// A token counts by a short hash, so no secret is kept; every Mini App launch shares one key.
function keysOf(link: Link, open: OpenFrame): readonly string[] {
  const { auth } = open;
  const source = `source:${link.peer.source}`;
  if ("device" in auth) {
    return [source, `device:${auth.device}`];
  }
  return "token" in auth
    ? [source, `token:${sha256Hex(auth.token).slice(0, 16)}`]
    : [source, "telegram"];
}

/**
 * Ends a connection whose source or credential failed to sign in too often lately with
 * `bye protocol.busy`, and answers whether it did.
 */
export function endIfLockedOut(link: Link, open: OpenFrame): boolean {
  if (!link.context.failures.isLocked(keysOf(link, open))) {
    return false;
  }
  link.context.logger.warn("server.auth_locked_out", { traceId: link.id });
  sayBye(link, "protocol.busy", "Too many failed sign-ins; try again in a few minutes.");
  return true;
}

/**
 * Ends a sign-in that failed with `bye` and its code, counts the failure for its source and its
 * credential, and logs it by the connection's id and the code, never the credential.
 */
export function refuseSignIn(
  link: Link,
  open: OpenFrame,
  refusal: { readonly code: ErrorCode; readonly message: string },
): void {
  const { code, message } = refusal;
  const { failures, logger } = link.context;
  logger.warn("server.auth_failed", { traceId: link.id, errorCode: code });
  if (failures.fail(keysOf(link, open)).length > 0) {
    logger.warn("server.auth_locked_out", { traceId: link.id, errorCode: code });
  }
  sayBye(link, code, message);
}
