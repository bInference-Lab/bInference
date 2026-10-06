import { stableJson } from "@binference/core";
import { type Sha256Hex, sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";
import type { LedgerDraft, LedgerEntry } from "./ledger-entry.js";

/** The `prevHash` of the first ledger entry: 64 zeros. */
export const genesisLedgerHash: Sha256Hex = sha256HexSchema.parse("0".repeat(64));

/**
 * The hash of one ledger entry (database spec, section 2.5):
 * `SHA-256(prev_hash || stable_json({ seq, id, at, agent_id, kind, subject, data }))`, with an
 * absent agent or subject written as `null`.
 */
export function hashLedgerEntry(
  prevHash: Sha256Hex,
  entry: LedgerDraft & { readonly seq: number },
): Sha256Hex {
  const fields = stableJson({
    seq: entry.seq,
    id: entry.id,
    at: entry.atMs,
    agent_id: entry.agentId ?? null,
    kind: entry.kind,
    subject: entry.subject ?? null,
    data: entry.data,
  });
  return sha256Hex(`${prevHash}${fields}`);
}

/**
 * Places a draft at the end of the chain whose last entry is `last`: the next `seq`, the last
 * entry's hash as `prevHash`, and the entry's own hash. An empty ledger starts at `seq` 1 on 64
 * zeros. A store calls it inside the transaction that appends the entry.
 */
export function chainLedgerEntry(
  last: Pick<LedgerEntry, "seq" | "hash"> | undefined,
  draft: LedgerDraft,
): LedgerEntry {
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? genesisLedgerHash;
  return { ...draft, seq, prevHash, hash: hashLedgerEntry(prevHash, { ...draft, seq }) };
}
