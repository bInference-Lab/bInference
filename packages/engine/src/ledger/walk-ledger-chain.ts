import type { LedgerStore } from "../ports.js";
import {
  checkLedgerChain,
  genesisCheckpoint,
  type LedgerChainVerdict,
  type LedgerCheckpoint,
} from "./check-ledger-chain.js";

/**
 * The part of the ledger a walk checks: the entries after `from` (the genesis checkpoint when
 * absent), up to and including `seq` `to` (the newest entry when absent).
 */
export interface LedgerRange {
  readonly from?: LedgerCheckpoint;
  readonly to?: number;
}

const pageSize = 1_000;

interface Walk {
  readonly ledger: LedgerStore;
  readonly to: number | undefined;
  readonly signal: AbortSignal;
}

// Each page starts after the last entry checked, so the walk reads every entry once. An unbroken
// chain holds exactly `to - reached.seq` entries up to `to`, so the walk checks that many by
// position: a row missing or added inside the range still breaks the check.
async function walkFrom(walk: Walk, reached: LedgerCheckpoint): Promise<LedgerChainVerdict> {
  const { ledger, to, signal } = walk;
  const page = await ledger.list({ after: reached.seq, limit: pageSize }, { signal });
  const verdict = checkLedgerChain(
    reached,
    to === undefined ? page : page.slice(0, to - reached.seq),
  );
  if (!verdict.ok || verdict.value.seq === to) {
    return verdict;
  }
  if (page.length === pageSize) {
    return walkFrom(walk, verdict.value);
  }
  return to === undefined ? verdict : { ok: false, error: "missing", seq: verdict.value.seq + 1 };
}

/**
 * Walks the ledger's hash chain through the store, a page at a time, as `binference check` does
 * (database spec, section 2.5). Answers the checkpoint of the last entry checked, or the first
 * entry that breaks the chain. A range whose `to` lies past the last entry breaks as `missing`.
 * Rejects with the signal's reason once the signal aborts.
 */
export async function walkLedgerChain(
  ledger: LedgerStore,
  range: LedgerRange,
  options: { readonly signal: AbortSignal },
): Promise<LedgerChainVerdict> {
  const from = range.from ?? genesisCheckpoint;
  if (range.to !== undefined && range.to <= from.seq) {
    return { ok: true, value: from };
  }
  return walkFrom({ ledger, to: range.to, signal: options.signal }, from);
}
