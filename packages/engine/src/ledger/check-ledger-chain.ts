import type { Err, Ok } from "@binference/core";
import type { Sha256Hex } from "../records/sha256-hex.js";
import type { LedgerEntry } from "./ledger-entry.js";
import { genesisLedgerHash, hashLedgerEntry } from "./ledger-hash.js";

/**
 * A point of the chain the checker trusts: an entry's `seq` and `hash`. The genesis checkpoint is
 * `seq` 0 on 64 zeros, the point before the first entry.
 */
export interface LedgerCheckpoint {
  readonly seq: number;
  readonly hash: Sha256Hex;
}

/** The point before the first entry: a check from here covers the whole ledger. */
export const genesisCheckpoint: LedgerCheckpoint = { seq: 0, hash: genesisLedgerHash };

/**
 * Why the chain breaks at an entry:
 * - `seq_gap`: the entry does not take the next `seq`, so a row was removed or added before it.
 * - `prev_hash`: its `prevHash` is not the hash of the entry before it.
 * - `hash`: its own hash does not match its fields, so the row was edited.
 * - `missing`: the range ends after the last entry, so entries were cut off.
 */
export type LedgerBreakReason = "seq_gap" | "prev_hash" | "hash" | "missing";

/** The chain breaks: `error` says why, `seq` names the first entry that fails. */
export interface LedgerChainBroken extends Err<LedgerBreakReason> {
  readonly seq: number;
}

/** The chain holds up to the checkpoint in `value`, or breaks at the first bad entry. */
export type LedgerChainVerdict = Ok<LedgerCheckpoint> | LedgerChainBroken;

function broken(seq: number, error: LedgerBreakReason): LedgerChainBroken {
  return { ok: false, error, seq };
}

function reasonAt(from: LedgerCheckpoint, entry: LedgerEntry): LedgerBreakReason | undefined {
  if (entry.seq !== from.seq + 1) {
    return "seq_gap";
  }
  if (entry.prevHash !== from.hash) {
    return "prev_hash";
  }
  return entry.hash === hashLedgerEntry(entry.prevHash, entry) ? undefined : "hash";
}

/**
 * Checks entries that follow a trusted checkpoint, in `seq` order: each takes the next `seq`,
 * links to the hash before it and hashes to its own `hash`. Answers the checkpoint of the last
 * entry, `from` itself for no entries, or the first entry that breaks the chain.
 */
export function checkLedgerChain(
  from: LedgerCheckpoint,
  entries: readonly LedgerEntry[],
): LedgerChainVerdict {
  let reached = from;
  for (const entry of entries) {
    const reason = reasonAt(reached, entry);
    if (reason !== undefined) {
      return broken(reached.seq + 1, reason);
    }
    reached = { seq: entry.seq, hash: entry.hash };
  }
  return { ok: true, value: reached };
}
