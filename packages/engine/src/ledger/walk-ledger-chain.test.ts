import { describe, expect, it } from "vitest";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { createMemoryLedgerStore, type MemoryLedgerStore } from "../fakes/memory-ledger-store.js";
import type { LedgerStore } from "../ports.js";
import { sha256Hex } from "../records/sha256-hex.js";
import type { LedgerEntry } from "./ledger-entry.js";
import { walkLedgerChain } from "./walk-ledger-chain.js";

// More than two pages of 1,000, so the walk carries the hash from one page to the next.
const count = 2_345;

function filledLedger(): MemoryLedgerStore {
  const ledger = createMemoryLedgerStore();
  for (let n = 1; n <= count; n += 1) {
    ledger.appendNow({ id: fixtureId("led", n), atMs: n, kind: "proposed", data: { n } });
  }
  return ledger;
}

async function entryAt(ledger: LedgerStore, seq: number): Promise<LedgerEntry> {
  const [entry] = await ledger.list({ after: seq - 1, limit: 1 }, live());
  if (entry === undefined) {
    throw new Error(`The ledger has no entry ${String(seq)}.`);
  }
  return entry;
}

// A ledger whose stored rows someone changed behind the store's back: each listed row becomes
// what `change` makes of it, none, or several.
function tampered(
  ledger: LedgerStore,
  change: (entry: LedgerEntry) => readonly LedgerEntry[],
): LedgerStore {
  return {
    ...ledger,
    list: async (page, options) => (await ledger.list(page, options)).flatMap(change),
  };
}

const editRow = (seq: number, edit: (entry: LedgerEntry) => LedgerEntry) => (entry: LedgerEntry) =>
  entry.seq === seq ? [edit(entry)] : [entry];
const deleteRow = (seq: number) => (entry: LedgerEntry) => (entry.seq === seq ? [] : [entry]);
const addRowAfter = (seq: number) => (entry: LedgerEntry) =>
  entry.seq === seq ? [entry, { ...entry, seq: seq + 1 }] : [entry];

describe("walkLedgerChain", () => {
  it("walks the whole chain page by page to the newest entry", async () => {
    const ledger = filledLedger();
    const last = await entryAt(ledger, count);
    await expect(walkLedgerChain(ledger, {}, live())).resolves.toStrictEqual({
      ok: true,
      value: { seq: count, hash: last.hash },
    });
  });

  it("answers genesis for an empty ledger", async () => {
    await expect(walkLedgerChain(createMemoryLedgerStore(), {}, live())).resolves.toStrictEqual({
      ok: true,
      value: { seq: 0, hash: "0".repeat(64) },
    });
  });

  it("finds a row edited on a later page", async () => {
    const edited = tampered(
      filledLedger(),
      editRow(1_500, (entry) => ({ ...entry, data: { n: 0 } })),
    );
    await expect(walkLedgerChain(edited, {}, live())).resolves.toStrictEqual({
      ok: false,
      error: "hash",
      seq: 1_500,
    });
  });

  it("finds a row deleted at a page boundary", async () => {
    const deleted = tampered(filledLedger(), deleteRow(1_001));
    await expect(walkLedgerChain(deleted, {}, live())).resolves.toStrictEqual({
      ok: false,
      error: "seq_gap",
      seq: 1_001,
    });
  });

  it("finds a row added inside a range", async () => {
    const added = tampered(filledLedger(), addRowAfter(10));
    await expect(walkLedgerChain(added, { to: 20 }, live())).resolves.toMatchObject({
      ok: false,
      seq: 11,
    });
  });

  it("checks a range from a trusted checkpoint up to a seq, inclusive", async () => {
    const ledger = filledLedger();
    const from = { seq: 2, hash: (await entryAt(ledger, 2)).hash };
    const edited = tampered(
      ledger,
      editRow(2_000, (entry) => ({ ...entry, kind: "denied" })),
    );
    await expect(walkLedgerChain(edited, { from, to: 1_999 }, live())).resolves.toStrictEqual({
      ok: true,
      value: { seq: 1_999, hash: (await entryAt(ledger, 1_999)).hash },
    });
    await expect(walkLedgerChain(edited, { from, to: 2_000 }, live())).resolves.toMatchObject({
      ok: false,
      seq: 2_000,
    });
  });

  it("answers the checkpoint itself for a range that ends at or before it", async () => {
    const from = { seq: 5, hash: sha256Hex("a trusted entry") };
    await expect(walkLedgerChain(filledLedger(), { from, to: 5 }, live())).resolves.toStrictEqual({
      ok: true,
      value: from,
    });
    await expect(walkLedgerChain(filledLedger(), { from, to: 3 }, live())).resolves.toStrictEqual({
      ok: true,
      value: from,
    });
  });

  it("names entries cut off the end of a range as missing", async () => {
    await expect(walkLedgerChain(filledLedger(), { to: count + 3 }, live())).resolves.toStrictEqual(
      { ok: false, error: "missing", seq: count + 1 },
    );
    await expect(
      walkLedgerChain(createMemoryLedgerStore(), { to: 1 }, live()),
    ).resolves.toStrictEqual({ ok: false, error: "missing", seq: 1 });
  });

  it("rejects with the signal's reason once the signal aborts", async () => {
    const reason = new Error("stopped by the owner");
    await expect(
      walkLedgerChain(filledLedger(), {}, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });
});
