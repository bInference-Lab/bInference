import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";
import { checkLedgerChain, genesisCheckpoint } from "./check-ledger-chain.js";
import type { LedgerDraft, LedgerEntry } from "./ledger-entry.js";
import { chainLedgerEntry } from "./ledger-hash.js";

function draft(n: number): LedgerDraft {
  return {
    id: fixtureId("led", n),
    atMs: 1_000 * n,
    agentId: fixtureId("agt", 1),
    kind: "reconciled",
    subject: fixtureId("int", n),
    data: { sold: "1500000000000000000", fills: [n, "paper", null] },
  };
}

function chainOf(count: number): readonly LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (let n = 1; n <= count; n += 1) {
    entries.push(chainLedgerEntry(entries.at(-1), draft(n)));
  }
  return entries;
}

const entries = chainOf(4);
const otherHash = sha256Hex("another entry");

function entryAt(seq: number): LedgerEntry {
  const entry = entries[seq - 1];
  if (entry === undefined) {
    throw new Error(`The fixture has no entry ${String(seq)}.`);
  }
  return entry;
}

function hashAt(seq: number): Sha256Hex {
  return entryAt(seq).hash;
}

// The fixture chain with entry 3 replaced by what `edit` makes of it.
function withThird(edit: (entry: LedgerEntry) => LedgerEntry): readonly LedgerEntry[] {
  return entries.map((entry) => (entry.seq === 3 ? edit(entry) : entry));
}

function check(edit: (entry: LedgerEntry) => LedgerEntry): unknown {
  return checkLedgerChain(genesisCheckpoint, withThird(edit));
}

// Every column of a ledger row, each edited the way a person with the database file could.
const edits: readonly (readonly [string, (entry: LedgerEntry) => LedgerEntry])[] = [
  ["seq", (entry) => ({ ...entry, seq: entry.seq + 1 })],
  ["id", (entry) => ({ ...entry, id: fixtureId("led", 99) })],
  ["at", (entry) => ({ ...entry, atMs: entry.atMs + 1 })],
  ["agent_id", (entry) => ({ ...entry, agentId: fixtureId("agt", 2) })],
  ["agent_id to null", ({ agentId: _agentId, ...entry }) => entry],
  ["kind", (entry) => ({ ...entry, kind: "denied" })],
  ["subject", (entry) => ({ ...entry, subject: fixtureId("int", 99) })],
  ["subject to null", ({ subject: _subject, ...entry }) => entry],
  ["data", (entry) => ({ ...entry, data: { sold: "1500000000000000001", fills: [3] } })],
  ["prev_hash", (entry) => ({ ...entry, prevHash: otherHash })],
  ["hash", (entry) => ({ ...entry, hash: otherHash })],
];

describe("checkLedgerChain", () => {
  it("answers the last entry's checkpoint for an unbroken chain from genesis", () => {
    expect(checkLedgerChain(genesisCheckpoint, entries)).toStrictEqual({
      ok: true,
      value: { seq: 4, hash: hashAt(4) },
    });
  });

  it("answers the checkpoint it starts from when there is nothing to check", () => {
    const from = { seq: 2, hash: otherHash };
    expect(checkLedgerChain(from, [])).toStrictEqual({ ok: true, value: from });
  });

  it("checks a range that starts at a trusted checkpoint", () => {
    expect(checkLedgerChain({ seq: 2, hash: hashAt(2) }, entries.slice(2))).toStrictEqual({
      ok: true,
      value: { seq: 4, hash: hashAt(4) },
    });
    expect(checkLedgerChain({ seq: 2, hash: otherHash }, entries.slice(2))).toStrictEqual({
      ok: false,
      error: "prev_hash",
      seq: 3,
    });
  });

  it.each(edits)("breaks at a row whose %s was edited", (_column, edit) => {
    expect(checkLedgerChain(genesisCheckpoint, withThird(edit))).toMatchObject({
      ok: false,
      seq: 3,
    });
  });

  it("names why each kind of edit breaks the chain", () => {
    expect(check((entry) => ({ ...entry, kind: "denied" }))).toStrictEqual({
      ok: false,
      error: "hash",
      seq: 3,
    });
    expect(check((entry) => ({ ...entry, prevHash: otherHash }))).toStrictEqual({
      ok: false,
      error: "prev_hash",
      seq: 3,
    });
    expect(check((entry) => ({ ...entry, seq: 5 }))).toStrictEqual({
      ok: false,
      error: "seq_gap",
      seq: 3,
    });
  });

  it("breaks after a row was deleted, and at a row added or moved", () => {
    const without = [entryAt(1), entryAt(3), entryAt(4)];
    expect(checkLedgerChain(genesisCheckpoint, without)).toStrictEqual({
      ok: false,
      error: "seq_gap",
      seq: 2,
    });
    const swapped = [entryAt(1), entryAt(3), entryAt(2), entryAt(4)];
    expect(checkLedgerChain(genesisCheckpoint, swapped)).toMatchObject({ ok: false, seq: 2 });
    const replayed = [...entries, entryAt(4)];
    expect(checkLedgerChain(genesisCheckpoint, replayed)).toMatchObject({ ok: false, seq: 5 });
  });

  it("breaks at the next row when an edited row also got its hash recomputed", () => {
    const rehashed = withThird(() => chainLedgerEntry(entryAt(2), { ...draft(3), kind: "denied" }));
    expect(checkLedgerChain(genesisCheckpoint, rehashed)).toStrictEqual({
      ok: false,
      error: "prev_hash",
      seq: 4,
    });
  });
});
