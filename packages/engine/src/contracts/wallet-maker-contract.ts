import assert from "node:assert/strict";
import { type AccountRef, accountRefParts } from "@binference/chain";
import { err, type Id, type Secret } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { WalletMaker } from "../install/ports.js";
import type { MadeWallet } from "../install/wallet-request.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/** A wallet maker under test, with the keys, venues and accounts a check uses. */
export interface WalletMakerSubject {
  readonly maker: WalletMaker;
  /** The code of the owner key that owns the install. */
  readonly ownerKey: Secret;
  /** A well-formed code of another key. */
  readonly otherKey: Secret;
  /** Venues the install runs, which a ceiling may let a wallet call. */
  readonly venues: readonly string[];
  readonly recipients: readonly [AccountRef, AccountRef];
  /** A new wallet id on each call. */
  nextWallet(): Id<"wal">;
  /** The accounts the ceiling of a made wallet lets a send pay, sorted, as custody holds it. */
  recipientsOf(made: MadeWallet): Promise<readonly AccountRef[]>;
  /** Whether custody holds a made wallet's ceiling as a launch wallet's (decision 0217). */
  isLaunchCeiling(made: MadeWallet): Promise<boolean>;
  /** How many wallets custody was asked to make so far. */
  made(): number;
}

/** Makes a fresh subject for each check. */
export interface WalletMakerHarness {
  create(): Promise<WalletMakerSubject>;
}

function requestOf(subject: WalletMakerSubject, ownerKey: Secret = subject.ownerKey) {
  const { venues, recipients } = subject;
  return { wallet: subject.nextWallet(), ownerKey, venues, recipients, isLaunch: false };
}

async function makesALaunchWallet(subject: WalletMakerSubject): Promise<void> {
  const launch = await subject.maker.make({ ...requestOf(subject), isLaunch: true }, live());
  const agentWallet = await subject.maker.make(requestOf(subject), live());
  assert.ok(launch.ok && agentWallet.ok);
  assert.equal(await subject.isLaunchCeiling(launch.value), true);
  assert.equal(await subject.isLaunchCeiling(agentWallet.value), false);
  assert.deepEqual(await subject.recipientsOf(launch.value), subject.recipients.toSorted());
}

async function makesAWallet(subject: WalletMakerSubject): Promise<void> {
  const made = await subject.maker.make(requestOf(subject), live());
  assert.ok(made.ok);
  const { record, account } = made.value;
  assert.equal(record.custody, "privy");
  assert.equal(record.ceiling.policyId, record.policyId);
  assert.equal(accountRefParts(account).address, record.address);
  assert.deepEqual(await subject.recipientsOf(made.value), subject.recipients.toSorted());
  assert.equal(subject.made(), 1);
}

async function makesWalletsApart(subject: WalletMakerSubject): Promise<void> {
  const first = await subject.maker.make(requestOf(subject), live());
  const second = await subject.maker.make(requestOf(subject), live());
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.value.record.custodyWalletId, second.value.record.custodyWalletId);
  assert.notEqual(first.value.record.address, second.value.record.address);
  assert.notEqual(first.value.record.policyId, second.value.record.policyId);
}

async function refusesAnotherKey(subject: WalletMakerSubject): Promise<void> {
  const refused = await subject.maker.make(requestOf(subject, subject.otherKey), live());
  assert.deepEqual(refused, err("bad_owner_key"));
  assert.equal(subject.made(), 0);
}

async function refusesAborted(subject: WalletMakerSubject): Promise<void> {
  await assertRefusesAborted(async (call) => subject.maker.make(requestOf(subject), call));
  assert.equal(subject.made(), 0);
}

/** The contract every {@link WalletMaker} adapter passes. */
export function walletMakerContract(harness: WalletMakerHarness): readonly ContractCheck[] {
  const create = async (): Promise<WalletMakerSubject> => harness.create();
  return [
    checkOn("makes a wallet whose ceiling sends only to the recipients", create, makesAWallet),
    checkOn("makes each wallet with its own ceiling and address", create, makesWalletsApart),
    checkOn(
      "makes a launch wallet whose ceiling holds the launch rules, and no other",
      create,
      makesALaunchWallet,
    ),
    checkOn("refuses another owner key and makes nothing", create, refusesAnotherKey),
    checkOn("refuses an aborted call and makes nothing", create, refusesAborted),
  ];
}
