import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { LedgerDraft, LedgerEntry } from "../ledger/ledger-entry.js";
import { genesisLedgerHash, hashLedgerEntry } from "../ledger/ledger-hash.js";
import type { LedgerStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/** A ledger under test, and an agent that exists in its database, for the entries that name one. */
export interface LedgerStoreSubject {
  readonly ledger: LedgerStore;
  readonly agentId: Id<"agt">;
}

/** Makes a fresh, empty ledger for each check. */
export interface LedgerStoreHarness {
  create(): Promise<LedgerStoreSubject>;
}

function draft(subject: LedgerStoreSubject, n: number): LedgerDraft {
  return {
    id: fixtureId("led", n),
    atMs: 1_000 + n,
    agentId: subject.agentId,
    kind: "proposed",
    subject: fixtureId("int", n),
    data: { amount: "1500000000000000000", nested: { list: [1, "two", null] } },
  };
}

async function appendAll(
  subject: LedgerStoreSubject,
  numbers: readonly number[],
): Promise<readonly LedgerEntry[]> {
  return inOrder(numbers, async (n) => subject.ledger.append(draft(subject, n), live()));
}

async function chainsEntries(subject: LedgerStoreSubject): Promise<void> {
  const entries = await appendAll(subject, [1, 2, 3]);
  for (const [index, entry] of entries.entries()) {
    const { seq, prevHash, hash } = entry;
    assert.equal(seq, index + 1);
    assert.equal(prevHash, entries[index - 1]?.hash ?? genesisLedgerHash);
    assert.equal(hash, hashLedgerEntry(prevHash, entry));
    assert.deepEqual(entry, { ...draft(subject, index + 1), seq, prevHash, hash });
  }
  assert.deepEqual(await subject.ledger.last(live()), entries[2]);
}

async function listsPages(subject: LedgerStoreSubject): Promise<void> {
  const entries = await appendAll(subject, [1, 2, 3, 4]);
  const first = await subject.ledger.list({ after: 0, limit: 3 }, live());
  const rest = await subject.ledger.list({ after: 3, limit: 3 }, live());
  assert.deepEqual(first, entries.slice(0, 3));
  assert.deepEqual(rest, entries.slice(3));
}

async function keepsBareEntries({ ledger }: LedgerStoreSubject): Promise<void> {
  assert.equal(await ledger.last(live()), undefined);
  const bare: LedgerDraft = { id: fixtureId("led", 9), atMs: 5, kind: "freeze", data: null };
  const entry = await ledger.append(bare, live());
  assert.deepEqual(await ledger.list({ after: 0, limit: 10 }, live()), [entry]);
  assert.ok(!("agentId" in entry) && !("subject" in entry));
  assert.equal(entry.hash, hashLedgerEntry(genesisLedgerHash, { ...bare, seq: 1 }));
}

async function refusesTakenIds(subject: LedgerStoreSubject): Promise<void> {
  const first = await subject.ledger.append(draft(subject, 1), live());
  const again = { ...draft(subject, 1), kind: "denied" };
  await assert.rejects(subject.ledger.append(again, live()), { code: "store.constraint" });
  assert.deepEqual(await subject.ledger.list({ after: 0, limit: 10 }, live()), [first]);
}

async function refusesAborted(subject: LedgerStoreSubject): Promise<void> {
  const { ledger } = subject;
  await assertRefusesAborted(async (options) => ledger.append(draft(subject, 1), options));
  await assertRefusesAborted(async (options) => ledger.list({ after: 0, limit: 1 }, options));
  await assertRefusesAborted(async (options) => ledger.last(options));
  assert.equal(await ledger.last(live()), undefined);
}

/** The contract every `LedgerStore` adapter passes. */
export function ledgerStoreContract(harness: LedgerStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<LedgerStoreSubject> => harness.create();
  return [
    checkOn("appends entries in order, each chained on the one before", create, chainsEntries),
    checkOn("lists the entries after a seq, at most the limit", create, listsPages),
    checkOn("keeps an entry with no agent, no subject and null data", create, keepsBareEntries),
    checkOn(
      "refuses a second entry with an id in use and appends nothing",
      create,
      refusesTakenIds,
    ),
    checkOn("refuses every call on an aborted signal and appends nothing", create, refusesAborted),
  ];
}
