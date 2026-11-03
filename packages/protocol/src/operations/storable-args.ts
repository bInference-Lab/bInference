import { err, type JsonValue, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "../errors/protocol-error-codes.js";
import { type OperationName, operations } from "./operations.js";
import { ownerKeyFields } from "./owner-key-operations.js";

// The fields besides the owner key that hold a secret the engine never keeps, by operation.
const secretFields: Readonly<Partial<Record<OperationName, readonly string[]>>> = {
  "engine/unlock": ["passphrase"],
};

/**
 * A call's args without the fields that hold a secret the engine never keeps: the passphrase of
 * `engine/unlock`, and the owner key code of every operation that takes it. The server hashes
 * these for a write's idempotency key, so the idempotency store holds no trace of a passphrase or
 * an owner key. Any other operation's args come back as they came.
 */
export function storableArgs(op: OperationName, args: JsonValue): JsonValue {
  const fields = [...(secretFields[op] ?? []), ...ownerKeyFields(operations[op])];
  if (fields.length === 0 || typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }
  const kept = Object.entries(args).filter(
    ([name]: readonly [string, JsonValue]) => !fields.includes(name),
  );
  return Object.fromEntries(kept);
}

// The writes whose result holds a webhook rule's URL, which ends in its secret: shown once, kept
// nowhere (decision 0337).
const shownOnce: ReadonlySet<string> = new Set<OperationName>([
  "webhookRule/create",
  "webhookRule/rotateUrl",
]);

/**
 * A write's result as the idempotency store may keep it: for a write whose result holds a secret
 * shown once, a webhook rule's URL, the result without it, so the store holds no trace of the
 * secret. Any other write's result comes back as it came.
 */
export function storableResult(op: string, result: JsonValue): JsonValue {
  if (
    !shownOnce.has(op) ||
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result)
  ) {
    return result;
  }
  const kept = Object.entries(result).filter(
    ([name]: readonly [string, JsonValue]) => name !== "url",
  );
  return Object.fromEntries(kept);
}

/**
 * The answer to a write sent again with its key, from the result the idempotency store kept: that
 * result, or `webhook.url_shown` for a write whose URL was shown once, so a repeat never reads the
 * secret again and the owner rotates the rule for a new URL (decision 0337).
 */
export function repeatedResult(
  op: string,
  stored: JsonValue,
): Result<JsonValue, ProtocolErrorCode> {
  return shownOnce.has(op) ? err("webhook.url_shown") : ok(stored);
}
