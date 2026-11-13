import { BinferenceError } from "@binference/core";

// The faults that say this engine no longer holds its install (decisions 0418 and 0425).
const lostLeaseCodes: ReadonlySet<string> = new Set(["store.lease_lost", "store.lease_mismatch"]);

/**
 * Whether a fault says this engine no longer holds its install: `store.lease_lost`, thrown by a
 * store write whose lease another worker took and by a signer service that no longer sees the
 * lease, or `store.lease_mismatch`, thrown by a store host bound to another install's lease
 * (decisions 0418 and 0425). A store without leases throws neither.
 */
export function isLeaseLost(fault: Error["cause"]): fault is BinferenceError {
  return fault instanceof BinferenceError && lostLeaseCodes.has(fault.code);
}

/**
 * Throws a lost lease on, untouched, and does nothing for any other fault. A catch in the money
 * code that turns a fault into a stored end, a skip, a count or another try calls it first, so
 * nothing is written or asked again once the install is another worker's: that worker's
 * recovery takes each intent from what is stored (decision 0436).
 */
export function throwIfLeaseLost(fault: Error["cause"]): void {
  if (isLeaseLost(fault)) {
    throw fault;
  }
}
