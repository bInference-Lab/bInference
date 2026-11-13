import { stableJson } from "@binference/core";
import type {
  IdempotencyEntry,
  IdempotencyLookup,
  IdempotencyMark,
  IdempotencyPrune,
  IdempotencyStart,
} from "../ingress/idempotency-entry.js";
import type { IdempotencyStore } from "../ingress/ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

// One key as the store keeps it: started with no result while its write runs (decision 0437).
interface KeptKey extends IdempotencyLookup {
  readonly result?: IdempotencyEntry["result"];
  readonly atMs: number;
}

type Keys = Map<string, KeptKey>;

function keyOf(lookup: IdempotencyLookup): string {
  return JSON.stringify([lookup.credential, lookup.op, lookup.key]);
}

function startOf(kept: KeptKey, lookup: IdempotencyLookup): IdempotencyStart {
  if (kept.argsHash !== lookup.argsHash) {
    return { kind: "reused" };
  }
  return kept.result === undefined
    ? { kind: "unfinished" }
    : { kind: "repeat", result: structuredClone(kept.result) };
}

function start(keys: Keys, mark: IdempotencyMark): IdempotencyStart {
  const kept = keys.get(keyOf(mark));
  if (kept !== undefined) {
    return startOf(kept, mark);
  }
  keys.set(keyOf(mark), { ...mark });
  return { kind: "started" };
}

function finish(keys: Keys, entry: IdempotencyEntry): void {
  const kept = keys.get(keyOf(entry));
  if (kept !== undefined && kept.argsHash !== entry.argsHash) {
    throw constraintFault("a result for a key that was started with other args");
  }
  if (kept?.result === undefined) {
    keys.set(keyOf(entry), { ...entry, result: structuredClone(entry.result) });
    return;
  }
  if (stableJson(kept.result) !== stableJson(entry.result)) {
    throw constraintFault("a second result for a key that holds one");
  }
}

function forget(keys: Keys, lookup: IdempotencyLookup): void {
  const kept = keys.get(keyOf(lookup));
  if (kept !== undefined && kept.result === undefined && kept.argsHash === lookup.argsHash) {
    keys.delete(keyOf(lookup));
  }
}

function prune(keys: Keys, cut: IdempotencyPrune): number {
  const running = new Set(cut.running.map(keyOf));
  const before = keys.size;
  for (const [key, kept] of keys) {
    if (kept.atMs < cut.beforeMs && !running.has(key)) {
      keys.delete(key);
    }
  }
  return before - keys.size;
}

/** Creates an empty in-memory {@link IdempotencyStore} for tests. */
export function createMemoryIdempotencyStore(): IdempotencyStore {
  const keys: Keys = new Map();
  return {
    start: async (mark, options) => memoryCall(options, () => start(keys, mark)),
    finish: async (entry, options) => memoryCall(options, () => finish(keys, entry)),
    forget: async (lookup, options) => memoryCall(options, () => forget(keys, lookup)),
    prune: async (cut, options) => memoryCall(options, () => prune(keys, cut)),
  };
}
