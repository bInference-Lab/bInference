import type { ErrorCode } from "@binference/core";
import { sha256Hex } from "@binference/engine";
import type { OpenFrame } from "@binference/protocol";
import { type Link, sayBye } from "./connection-link.js";
import { type CountedKey, sourceKey } from "./lockout-alerts.js";

// The keys a sign-in's failures count under: where it came from, and the credential it claims.
// A token counts by a short hash, so no secret is kept, and its lockout names the token by the
// SHA-256 of its secret; every Mini App launch shares one key.
function countedKeysOf(link: Link, open: OpenFrame): readonly CountedKey[] {
  const { auth } = open;
  const source = sourceKey(link.peer.source);
  if ("device" in auth) {
    return [
      source,
      { key: `device:${auth.device}`, lockout: { kind: "device", device: auth.device } },
    ];
  }
  if ("token" in auth) {
    const secretHash = sha256Hex(auth.token);
    return [
      source,
      { key: `token:${secretHash.slice(0, 16)}`, lockout: { kind: "token", secretHash } },
    ];
  }
  return [source, { key: "telegram", lockout: { kind: "mini_app" } }];
}

function keysOf(link: Link, open: OpenFrame): readonly string[] {
  return countedKeysOf(link, open).map((item) => item.key);
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
 * credential, and logs it by the connection's id and the code, never the credential. A failure
 * that locks a source or credential out tells the owner, at most once a while per key.
 */
export function refuseSignIn(
  link: Link,
  open: OpenFrame,
  refusal: { readonly code: ErrorCode; readonly message: string },
): void {
  const { code, message } = refusal;
  const { failures, alerts, logger } = link.context;
  logger.warn("server.auth_failed", { traceId: link.id, errorCode: code });
  const counted = countedKeysOf(link, open);
  const locked = failures.fail(counted.map((item) => item.key));
  if (locked.length > 0) {
    logger.warn("server.auth_locked_out", { traceId: link.id, errorCode: code });
    alerts.locked(counted, locked);
  }
  sayBye(link, code, message);
}
