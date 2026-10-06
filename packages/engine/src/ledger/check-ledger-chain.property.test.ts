import type { JsonValue } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { sha256Hex } from "../records/sha256-hex.js";
import { checkLedgerChain, genesisCheckpoint } from "./check-ledger-chain.js";
import type { LedgerDraft, LedgerEntry } from "./ledger-entry.js";
import { chainLedgerEntry } from "./ledger-hash.js";

interface Row {
  readonly kind: string;
  readonly data: JsonValue;
  readonly hasAgent: boolean;
}

const rows: fc.Arbitrary<readonly Row[]> = fc.array(
  fc.record({
    kind: fc.string({ minLength: 1, maxLength: 12 }),
    data: fc.jsonValue({ maxDepth: 2 }) as fc.Arbitrary<JsonValue>,
    hasAgent: fc.boolean(),
  }),
  { minLength: 1, maxLength: 12 },
);

function draftOf(row: Row, index: number): LedgerDraft {
  const agent = row.hasAgent ? { agentId: fixtureId("agt", 1) } : {};
  return {
    id: fixtureId("led", index + 1),
    atMs: 1_000 + index,
    ...agent,
    kind: row.kind,
    data: row.data,
  };
}

function chainOf(all: readonly Row[]): readonly LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const [index, row] of all.entries()) {
    entries.push(chainLedgerEntry(entries.at(-1), draftOf(row, index)));
  }
  return entries;
}

// One edit per column, each to a value that always differs from the one stored.
const edits: readonly ((entry: LedgerEntry) => LedgerEntry)[] = [
  (entry) => ({ ...entry, seq: entry.seq + 1 }),
  (entry) => ({ ...entry, atMs: entry.atMs + 1 }),
  (entry) => ({ ...entry, kind: `${entry.kind}x` }),
  (entry) => ({ ...entry, subject: `${entry.subject ?? ""}x` }),
  (entry) => ({ ...entry, data: { was: entry.data } }),
  (entry) => ({ ...entry, prevHash: sha256Hex(entry.prevHash) }),
  (entry) => ({ ...entry, hash: sha256Hex(entry.hash) }),
  ({ agentId, ...entry }) =>
    agentId === undefined ? { ...entry, agentId: fixtureId("agt", 2) } : entry,
];

function editAt(
  entries: readonly LedgerEntry[],
  index: number,
  edit: (entry: LedgerEntry) => LedgerEntry,
): readonly LedgerEntry[] {
  return entries.map((entry, at) => (at === index ? edit(entry) : entry));
}

describe("checkLedgerChain properties", () => {
  it("verifies every chain it is given unchanged", () => {
    fc.assert(
      fc.property(rows, (all) => {
        const entries = chainOf(all);
        expect(checkLedgerChain(genesisCheckpoint, entries)).toStrictEqual({
          ok: true,
          value: { seq: all.length, hash: entries.at(-1)?.hash },
        });
      }),
    );
  });

  it("breaks exactly at the entry whose column was edited", () => {
    fc.assert(
      fc.property(rows, fc.nat(), fc.constantFrom(...edits), (all, pick, edit) => {
        const entries = chainOf(all);
        const index = pick % entries.length;
        const edited = editAt(entries, index, edit);
        expect(edited[index]).not.toStrictEqual(entries[index]);
        expect(checkLedgerChain(genesisCheckpoint, edited)).toMatchObject({
          ok: false,
          seq: index + 1,
        });
      }),
    );
  });
});
