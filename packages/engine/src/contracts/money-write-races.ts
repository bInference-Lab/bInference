import assert from "node:assert/strict";
import { assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { LedgerEntry } from "../ledger/ledger-entry.js";
import { genesisLedgerHash, hashLedgerEntry } from "../ledger/ledger-hash.js";
import type { LedgerStore } from "../ports.js";
import type { ExecutionWrite, PositionState } from "../positions/position-record.js";
import { countsOneLandedFill } from "./fill-write-races.js";
import { cardOf, confirmationOf, intentDraft, intentMove } from "./intent-fixtures.js";
import { keyRaces } from "./key-races.js";
import {
  conflict,
  firstOf,
  type MoneyRaceHarness,
  type MoneyRaceSubject,
  race,
  settled,
} from "./money-race-runs.js";
import { noDoubleBookingProperty } from "./money-write-property.js";
import { checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";
import { signed } from "./transaction-store-fixtures.js";

// The whole chain reads back unbroken: each `seq` the next, each hash over the entry before.
async function assertChain(ledger: LedgerStore): Promise<readonly LedgerEntry[]> {
  const entries = await ledger.list({ after: 0, limit: 1_000 }, live());
  let previous = genesisLedgerHash;
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.seq, index + 1);
    assert.equal(entry.prevHash, previous);
    assert.equal(entry.hash, hashLedgerEntry(previous, entry));
    previous = entry.hash;
  }
  return entries;
}

/** Writers that append at once leave one unbroken chain with each landed entry once. */
async function chainsEveryWritersEntries(subject: MoneyRaceSubject): Promise<void> {
  const perWriter = 6;
  const outcomes = await race(subject, async ({ ledger }, writer) =>
    inOrder([...Array.from({ length: perWriter }).keys()], async (k) => {
      const n = writer * perWriter + k + 1;
      const draft = { id: fixtureId("led", n), atMs: n, kind: "proposed", data: { n } };
      return settled(ledger.append(draft, live()));
    }),
  );
  const landed = outcomes.flat().filter((outcome) => outcome !== conflict);
  // The first writer to commit always lands, so a race that lands nothing proves nothing.
  assert.ok(landed.length > 0);
  const entries = await assertChain(firstOf(subject).ledger);
  assert.deepEqual(entries.map(({ id }) => id).toSorted(), landed.map(({ id }) => id).toSorted());
}

/** Writers that create intents at once store each landed one with one event and one entry. */
async function createsEachIntentOnce(subject: MoneyRaceSubject): Promise<void> {
  const perWriter = 3;
  const outcomes = await race(subject, async ({ intents }, writer) =>
    inOrder([...Array.from({ length: perWriter }).keys()], async (k) => {
      const n = writer * perWriter + k + 1;
      const created = await settled(intents.create(intentDraft(subject, n), live()));
      return { n, created };
    }),
  );
  const { intents, ledger } = firstOf(subject);
  const eventIds: number[] = [];
  let landed = 0;
  for (const { n, created } of outcomes.flat()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read per intent, after the race
    const events = await intents.events(fixtureId("int", n), live());
    if (created === conflict) {
      assert.deepEqual(events, []);
      continue;
    }
    assert.ok(created.ok);
    landed += 1;
    assert.deepEqual(events, [created.value.event]);
    eventIds.push(created.value.event.id);
  }
  assert.ok(landed > 0);
  assert.equal(new Set(eventIds).size, landed);
  assert.equal((await assertChain(ledger)).length, landed);
}

/** Of writers that confirm one card version at once, exactly one stores its confirmation. */
async function confirmsOneCardOnce(subject: MoneyRaceSubject): Promise<void> {
  const { intents } = firstOf(subject);
  assert.ok((await intents.create(intentDraft(subject, 1), live())).ok);
  const opened = { ...intentMove(1, 0, "awaiting_confirmation"), openCard: cardOf(1, 1) };
  assert.ok((await intents.transition(opened, live())).ok);
  const outcomes = await race(subject, async (writer, index) => {
    const confirmation = {
      ...confirmationOf(1, 1),
      id: fixtureId("cnf", 100 + index),
      byRef: `writer-${String(index)}`,
    };
    const move = { ...intentMove(1, 1, "confirmed"), confirmation };
    return settled(writer.intents.transition(move, live()));
  });
  const won = outcomes.filter((outcome) => outcome !== conflict && outcome.ok);
  assert.equal(won.length, 1);
  for (const outcome of outcomes) {
    assert.ok(outcome === conflict || outcome.ok || outcome.error === "stale");
  }
  assert.equal((await intents.get(fixtureId("int", 1), live()))?.version, 2);
  assert.equal((await intents.events(fixtureId("int", 1), live())).length, 3);
  const stored = await intents.confirmation(fixtureId("int", 1), live());
  const winner = outcomes.findIndex((outcome) => outcome !== conflict && outcome.ok);
  assert.equal(stored?.byRef, `writer-${String(winner)}`);
}

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");

function positionOf(walletId: Id<"wal">, quantityBase: bigint): PositionState {
  return {
    walletId,
    asset: token,
    isPaper: false,
    quantityBase,
    costUsdMicros: 1_000n,
    realizedUsdMicros: 0n,
    changedAtMs: 1_000,
  };
}

interface Execution {
  readonly intentId: Id<"int">;
  readonly quantityBase: bigint;
  readonly readVersion?: number;
}

function executionOf(subject: MoneyRaceSubject, planned: Execution): ExecutionWrite {
  const { intentId, quantityBase, readVersion } = planned;
  const position = positionOf(subject.walletId, quantityBase);
  return {
    execution: {
      intentId,
      walletId: subject.walletId,
      isPaper: false,
      atMs: 1_000,
      sold: { asset: coin, base: 10n },
      feeBase: 0n,
      bought: { asset: token, base: 10n },
      gas: { asset: coin, base: 1n },
      valueUsdMicros: 1_000n,
      feeUsdMicros: 0n,
      gasUsdMicros: 1n,
    },
    positions: [readVersion === undefined ? { position } : { position, readVersion }],
    realizedUsdMicros: 0n,
  };
}

/** Writers that move one position from the version each read land exactly one execution. */
async function movesOnePositionOnce(subject: MoneyRaceSubject): Promise<void> {
  const { intents, positions } = firstOf(subject);
  assert.ok((await intents.create(intentDraft(subject, 1), live())).ok);
  const intentId = fixtureId("int", 1);
  assert.ok(
    (await positions.record(executionOf(subject, { intentId, quantityBase: 10n }), live())).ok,
  );
  const outcomes = await race(subject, async (writer, index) =>
    settled(
      writer.positions.record(
        executionOf(subject, { intentId, quantityBase: 20n + BigInt(index), readVersion: 0 }),
        live(),
      ),
    ),
  );
  for (const outcome of outcomes) {
    assert.ok(outcome === conflict || outcome.ok || outcome.error === "stale");
  }
  const winner = outcomes.findIndex((outcome) => outcome !== conflict && outcome.ok);
  assert.equal(outcomes.filter((outcome) => outcome !== conflict && outcome.ok).length, 1);
  const held = await positions.positions({ walletId: subject.walletId, isPaper: false }, live());
  assert.deepEqual(held, [{ ...positionOf(subject.walletId, 20n + BigInt(winner)), version: 1 }]);
  const page = { after: 0, limit: 50, isPaper: false };
  assert.equal((await positions.executions(page, live())).length, 2);
}

/**
 * Writers that take a nonce and store a step at it at once never store two steps at one nonce. A
 * wallet queue takes and stores one step of an account at a time, so a nonce given and not yet
 * stored can be given again; the store keeps only one step there.
 */
async function grantsEachNonceOnce(subject: MoneyRaceSubject): Promise<void> {
  const { intents, transactions } = firstOf(subject);
  await inOrder([1, 2], async (n) => intents.create(intentDraft(subject, n), live()));
  const intentIds = [fixtureId("int", 1), fixtureId("int", 2)] as const;
  const [account] = subject.accounts;
  const outcomes = await race(subject, async (writer, index) => {
    const asked = { account, chainNonce: 5, atMs: 1 };
    const grant = await settled(writer.transactions.nextNonce(asked, live()));
    if (grant === conflict) {
      return undefined;
    }
    const step = { intentIds, accounts: subject.accounts };
    const saved = await settled(
      writer.transactions.saveSigned(signed(step, index + 1, grant.nonce), live()),
    );
    return { saved };
  });
  const savedIds: string[] = [];
  for (const outcome of outcomes) {
    if (outcome !== undefined && outcome.saved !== conflict) {
      assert.ok(outcome.saved.ok || outcome.saved.error === "nonce_taken");
      if (outcome.saved.ok) {
        savedIds.push(outcome.saved.value.id);
      }
    }
  }
  assert.ok(savedIds.length > 0);
  const stored = await transactions.list({ account, fromNonce: 0, limit: 50 }, live());
  const nonces = stored.map(({ nonce }) => nonce);
  assert.equal(new Set(nonces).size, nonces.length);
  assert.deepEqual(stored.map(({ id }) => id).toSorted(), savedIds.toSorted());
}

/**
 * The money statements under writers that race on one engine database (decision 0366): whatever
 * the interleaving, each write lands whole or not at all, a write that gave up on conflicts
 * leaves nothing, and no entry, event, confirmation, fill, position move or nonce lands twice; a
 * key a caller chose lands once and every other writer gets the port's answer for it. On a
 * database that retries, each race meets a conflict.
 */
export function moneyWriteRaces(harness: MoneyRaceHarness): readonly ContractCheck[] {
  const create = async (): Promise<MoneyRaceSubject> => harness.create();
  return [
    checkOn("chains every writer's ledger entries once", create, chainsEveryWritersEntries),
    checkOn("stores each intent the writers create once", create, createsEachIntentOnce),
    checkOn("stores one confirmation of a card the writers race", create, confirmsOneCardOnce),
    checkOn("counts one landed fill of an order the writers race", create, countsOneLandedFill),
    checkOn(
      "moves a position once from the version the writers read",
      create,
      movesOnePositionOnce,
    ),
    checkOn("gives each nonce the writers take once", create, grantsEachNonceOnce),
    ...keyRaces(create),
    noDoubleBookingProperty(harness, harness.propertyRuns ?? 10),
  ];
}
