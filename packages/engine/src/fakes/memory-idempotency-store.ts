import type {
  IdempotencyEntry,
  IdempotencyLookup,
  IdempotencyRecall,
} from "../ingress/idempotency-entry.js";
import type { IdempotencyStore } from "../ports.js";
import { memoryCall } from "./memory-call.js";

function keyOf(lookup: IdempotencyLookup): string {
  return JSON.stringify([lookup.credential, lookup.op, lookup.key]);
}

/** Creates an empty in-memory {@link IdempotencyStore} for tests. */
export function createMemoryIdempotencyStore(): IdempotencyStore {
  const entries = new Map<string, IdempotencyEntry>();
  const recall = (lookup: IdempotencyLookup): IdempotencyRecall => {
    const stored = entries.get(keyOf(lookup));
    if (stored === undefined) {
      return { kind: "new" };
    }
    return stored.argsHash === lookup.argsHash
      ? { kind: "repeat", result: structuredClone(stored.result) }
      : { kind: "reused" };
  };
  return {
    recall: async (lookup, options) => memoryCall(options, () => recall(lookup)),
    remember: async (entry, options) =>
      memoryCall(options, () => {
        const before = recall(entry);
        if (before.kind === "new") {
          entries.set(keyOf(entry), structuredClone(entry));
        }
        return before;
      }),
    prune: async (beforeMs, options) =>
      memoryCall(options, () => {
        const before = entries.size;
        for (const [key, entry] of entries) {
          if (entry.atMs < beforeMs) {
            entries.delete(key);
          }
        }
        return before - entries.size;
      }),
  };
}
