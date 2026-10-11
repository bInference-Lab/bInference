import assert from "node:assert/strict";
import type { AccountRef } from "@binference/chain";
import { err, ok, type Secret } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { CeilingRead } from "../install/ceiling-change.js";
import type { CeilingEditor } from "../install/ports.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/** A ceiling editor under test, a ceiling it holds and the keys and accounts a check uses. */
export interface CeilingEditorSubject {
  readonly editor: CeilingEditor;
  /** The owner key code that owns the ceiling. */
  readonly ownerKey: Secret;
  /** A well-formed code of another key. */
  readonly otherKey: Secret;
  /**
   * The ceiling the checks change; it lists `accounts[0]` and `accounts[1]` at the start, and
   * names one 24-hour cap or more.
   */
  readonly ceiling: string;
  /** A ceiling id custody does not hold. */
  readonly unknownCeiling: string;
  readonly accounts: readonly [AccountRef, AccountRef, AccountRef];
  /** A venue with a contract on every chain the ceiling enables, and one with none. */
  readonly venues: { readonly known: string; readonly unknown: string };
  /** What the ceiling lets a send pay now, sorted. */
  recipients(): Promise<readonly AccountRef[]>;
  /** The time custody checks a change's expiry against. */
  now(): number;
}

/** Makes a fresh subject for each check. */
export interface CeilingEditorHarness {
  create(): Promise<CeilingEditorSubject>;
}

const tenMinutesMs = 600_000;

function sorted(accounts: readonly AccountRef[]): readonly AccountRef[] {
  return accounts.toSorted();
}

async function setsRecipients(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ownerKey, ceiling, accounts } = subject;
  const request = { ownerKey, ceilings: [{ ceiling, recipients: [accounts[2], accounts[0]] }] };
  assert.deepEqual(await editor.setRecipients(request, live()), ok(undefined));
  assert.deepEqual(await subject.recipients(), sorted([accounts[0], accounts[2]]));
  assert.deepEqual(await editor.setRecipients(request, live()), ok(undefined));
  assert.deepEqual(await subject.recipients(), sorted([accounts[0], accounts[2]]));
}

async function refusesOthers(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ownerKey, otherKey, ceiling, unknownCeiling, accounts } = subject;
  const before = await subject.recipients();
  const recipients = [accounts[2]];
  const byOther = { ownerKey: otherKey, ceilings: [{ ceiling, recipients }] };
  assert.deepEqual(await editor.setRecipients(byOther, live()), err("bad_owner_key"));
  const unknown = { ownerKey, ceilings: [{ ceiling: unknownCeiling, recipients }] };
  assert.deepEqual(await editor.setRecipients(unknown, live()), err("not_found"));
  const signing = { ownerKey: otherKey, changes: [], untilMs: subject.now() + tenMinutesMs };
  assert.deepEqual(await editor.signRecipients(signing, live()), err("bad_owner_key"));
  assert.deepEqual(await subject.recipients(), before);
}

async function readsCeilings(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ceiling, unknownCeiling } = subject;
  const read = await editor.read(ceiling, live());
  assert.ok(read.ok);
  assert.deepEqual(sorted(read.value.recipients), await subject.recipients());
  assert.ok(read.value.chains.length > 0 && read.value.perTxNativeBase >= 0n);
  assert.deepEqual(await editor.read(unknownCeiling, live()), err("not_found"));
}

async function signsAhead(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ownerKey, ceiling, accounts } = subject;
  const from = [accounts[0], accounts[1]];
  const change = { ceiling, from, to: [accounts[0]] };
  const untilMs = subject.now() + tenMinutesMs;
  const signed = await editor.signRecipients({ ownerKey, changes: [change], untilMs }, live());
  assert.ok(signed.ok);
  assert.equal(signed.value.untilMs, untilMs);
  assert.deepEqual(await subject.recipients(), sorted(from));
  assert.deepEqual(await editor.sendSigned(signed.value, live()), ok(undefined));
  assert.deepEqual(await subject.recipients(), [accounts[0]]);
  assert.deepEqual(await editor.sendSigned(signed.value, live()), ok(undefined));
}

async function keepsLaterChanges(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ownerKey, ceiling, accounts } = subject;
  const change = { ceiling, from: [accounts[0], accounts[1]], to: [accounts[0]] };
  const untilMs = subject.now() + tenMinutesMs;
  const signed = await editor.signRecipients({ ownerKey, changes: [change], untilMs }, live());
  assert.ok(signed.ok);
  const later = { ownerKey, ceilings: [{ ceiling, recipients: [...accounts] }] };
  assert.deepEqual(await editor.setRecipients(later, live()), ok(undefined));
  assert.deepEqual(await editor.sendSigned(signed.value, live()), err("changed"));
  assert.deepEqual(await subject.recipients(), sorted(accounts));
}

async function refusesExpired(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ownerKey, ceiling, accounts } = subject;
  const change = { ceiling, from: [accounts[0], accounts[1]], to: [accounts[0]] };
  const untilMs = subject.now() - 1;
  const signed = await editor.signRecipients({ ownerKey, changes: [change], untilMs }, live());
  assert.ok(signed.ok);
  assert.deepEqual(await editor.sendSigned(signed.value, live()), err("expired"));
  assert.deepEqual(await subject.recipients(), sorted([accounts[0], accounts[1]]));
}

function callsOf(subject: CeilingEditorSubject, venue: string, ceiling = subject.ceiling) {
  return {
    ownerKey: subject.ownerKey,
    ceilings: [{ ceiling, venues: [venue], perTxNativeBase: 7n }],
  };
}

async function setsCalls(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ceiling } = subject;
  const request = callsOf(subject, subject.venues.known);
  assert.deepEqual(await editor.setCalls(request, live()), ok(undefined));
  const read = await editor.read(ceiling, live());
  assert.ok(read.ok);
  assert.ok(read.value.perTxNativeBase === 7n && read.value.contracts.length > 0);
  assert.deepEqual(sorted(read.value.recipients), await subject.recipients());
  assert.deepEqual(await editor.setCalls(request, live()), ok(undefined));
  assert.deepEqual(await editor.read(ceiling, live()), read);
}

async function refusesOtherCalls(subject: CeilingEditorSubject): Promise<void> {
  const { editor, venues } = subject;
  const before = await editor.read(subject.ceiling, live());
  const byOther = { ...callsOf(subject, venues.known), ownerKey: subject.otherKey };
  assert.deepEqual(await editor.setCalls(byOther, live()), err("bad_owner_key"));
  const unknown = callsOf(subject, venues.known, subject.unknownCeiling);
  assert.deepEqual(await editor.setCalls(unknown, live()), err("not_found"));
  assert.deepEqual(
    await editor.setCalls(callsOf(subject, venues.unknown), live()),
    err("no_calls"),
  );
  assert.deepEqual(await editor.read(subject.ceiling, live()), before);
}

// The size of every cap after the resize: $2,000 at each floor price.
const dayCapUsdMicros = 2_000_000_000n;

function shapeOf(caps: CeilingRead["dayCaps"]) {
  return caps.map((cap) => [cap.asset, cap.windowSeconds]);
}

async function resizesDayCaps(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ceiling } = subject;
  const before = await editor.read(ceiling, live());
  assert.ok(before.ok && before.value.dayCaps.length > 0, "The subject's ceiling names no caps.");
  const [calls] = callsOf(subject, subject.venues.known).ceilings;
  assert.ok(calls !== undefined);
  const request = {
    ownerKey: subject.ownerKey,
    ceilings: [{ ...calls, dayCapUsdMicros }],
  };
  assert.deepEqual(await editor.setCalls(request, live()), ok(undefined));
  const after = await editor.read(ceiling, live());
  assert.ok(after.ok);
  assert.deepEqual(shapeOf(after.value.dayCaps), shapeOf(before.value.dayCaps));
  assert.ok(after.value.dayCaps.every((cap) => cap.floorUsdMicros >= dayCapUsdMicros));
  assert.deepEqual(sorted(after.value.recipients), await subject.recipients());
  assert.deepEqual(await editor.setCalls(request, live()), ok(undefined));
  assert.deepEqual(await editor.read(ceiling, live()), after);
  const byOther = { ...request, ownerKey: subject.otherKey };
  assert.deepEqual(await editor.setCalls(byOther, live()), err("bad_owner_key"));
  assert.deepEqual(await editor.read(ceiling, live()), after);
}

async function refusesAborted(subject: CeilingEditorSubject): Promise<void> {
  const { editor, ownerKey, ceiling, accounts } = subject;
  const request = { ownerKey, ceilings: [{ ceiling, recipients: [accounts[2]] }] };
  await assertRefusesAborted(async (options) => editor.setRecipients(request, options));
  const signing = { ownerKey, changes: [], untilMs: subject.now() };
  await assertRefusesAborted(async (options) => editor.signRecipients(signing, options));
  const change = { untilMs: subject.now(), payload: [] };
  await assertRefusesAborted(async (options) => editor.sendSigned(change, options));
  await assertRefusesAborted(async (options) => editor.read(ceiling, options));
  const calls = callsOf(subject, subject.venues.known);
  await assertRefusesAborted(async (options) => editor.setCalls(calls, options));
  assert.deepEqual(await subject.recipients(), sorted([accounts[0], accounts[1]]));
}

/** The contract every `CeilingEditor` adapter passes. */
export function ceilingEditorContract(harness: CeilingEditorHarness): readonly ContractCheck[] {
  const create = async (): Promise<CeilingEditorSubject> => harness.create();
  return [
    checkOn("reads what a ceiling lets a send pay, and no unknown ceiling", create, readsCeilings),
    checkOn("sets a ceiling's recipients with the owner key, twice alike", create, setsRecipients),
    checkOn("refuses another key and an unknown ceiling, changing nothing", create, refusesOthers),
    checkOn("signs a change ahead that changes nothing until it is sent", create, signsAhead),
    checkOn("never sends a change signed ahead over a later change", create, keepsLaterChanges),
    checkOn("refuses a change signed ahead once its time has passed", create, refusesExpired),
    checkOn("sets what a contract call may do with the owner key, twice alike", create, setsCalls),
    checkOn(
      "refuses calls by another key, on an unknown ceiling or with no contract",
      create,
      refusesOtherCalls,
    ),
    checkOn(
      "resizes every 24-hour cap with the owner key, each still counting what it did",
      create,
      resizesDayCaps,
    ),
    checkOn("refuses every call on an aborted signal and changes nothing", create, refusesAborted),
  ];
}
