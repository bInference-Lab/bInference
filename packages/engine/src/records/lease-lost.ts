import { BinferenceError } from "@binference/core";

// The faults that say this engine may write no more for its install (decisions 0418, 0425 and
// 0438).
const lostLeaseCodes: ReadonlySet<string> = new Set([
  "store.lease_lost",
  "store.lease_mismatch",
  "store.commit_unknown",
]);

/**
 * Whether a fault says this engine may write no more for its install: `store.lease_lost`, thrown
 * by a store write whose lease another worker took and by a signer service that no longer sees the
 * lease; `store.lease_mismatch`, thrown by a store host bound to another install's lease
 * (decisions 0418 and 0425); or `store.commit_unknown`, after which the Postgres store host
 * refuses every write and its owner stops the install (decision 0438). The SQLite store throws
 * none of them.
 */
export function isLeaseLost(fault: Error["cause"]): fault is BinferenceError {
  return fault instanceof BinferenceError && lostLeaseCodes.has(fault.code);
}

/**
 * Throws a lost lease or an unknown commit on, untouched, and does nothing for any other fault. A
 * catch in the money code that turns a fault into a stored end, a skip, a count or another try
 * calls it first, so nothing is written or asked again once the install's writes stopped: the
 * next start's recovery takes each intent from what is stored (decisions 0436 and 0438).
 */
export function throwIfLeaseLost(fault: Error["cause"]): void {
  if (isLeaseLost(fault)) {
    throw fault;
  }
}
