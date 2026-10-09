import type { JsonValue } from "@binference/core";
import type { OperationName } from "./operations.js";

// The fields that hold a secret the engine never keeps, by operation.
const secretFields: Readonly<Partial<Record<OperationName, readonly string[]>>> = {
  "engine/unlock": ["passphrase"],
};

/**
 * A call's args without the fields that hold a secret the engine never keeps, such as the
 * passphrase of `engine/unlock`. The server hashes these for a write's idempotency key, so the
 * idempotency store holds no trace of a passphrase. Any other operation's args come back as they
 * came.
 */
export function storableArgs(op: OperationName, args: JsonValue): JsonValue {
  const fields = secretFields[op];
  if (fields === undefined || typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }
  const kept = Object.entries(args).filter(
    ([name]: readonly [string, JsonValue]) => !fields.includes(name),
  );
  return Object.fromEntries(kept);
}
