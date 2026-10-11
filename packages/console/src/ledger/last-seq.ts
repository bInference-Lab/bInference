/** Reads up to `limit` ledger entries after the one numbered `after`, oldest first. */
export type LedgerPageReader = (after: number, limit: number) => Promise<number>;

// Whether the ledger holds an entry numbered `seq`.
async function holds(read: LedgerPageReader, seq: number): Promise<boolean> {
  return (await read(seq - 1, 1)) > 0;
}

// Doubles from `seq` until the ledger holds no entry there.
async function firstMissing(read: LedgerPageReader, seq: number): Promise<number> {
  return (await holds(read, seq)) ? firstMissing(read, seq * 2) : seq;
}

// The last entry the ledger holds between `held` and `missing`, halving the gap each read.
async function lastBetween(read: LedgerPageReader, held: number, missing: number): Promise<number> {
  if (missing - held <= 1) {
    return held;
  }
  const middle = Math.floor((held + missing) / 2);
  return (await holds(read, middle))
    ? lastBetween(read, middle, missing)
    : lastBetween(read, held, middle);
}

/**
 * The number of the ledger's last entry, 0 for an empty ledger. Entries are numbered from 1 with
 * no gap, and `ledger/list` pages forward from a number, so it doubles, then halves: about two
 * reads of one entry per doubling of the ledger's length.
 */
export async function lastSeq(read: LedgerPageReader): Promise<number> {
  const missing = await firstMissing(read, 1);
  return lastBetween(read, Math.floor(missing / 2), missing);
}
