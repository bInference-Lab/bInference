import type { JsonValue } from "@binference/core";
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
