import assert from "node:assert/strict";
import { err, ok, type Secret } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { SignerRevoker } from "../install/ports.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/**
 * A signer revoker under test: wallets that each list two signers, `signer` and `kept`, and the
 * keys and ids a check uses.
 */
export interface SignerRevokerSubject {
  readonly revoker: SignerRevoker;
  /** The code of the owner key that owns the wallets. */
  readonly ownerKey: Secret;
  /** A well-formed code of another key. */
  readonly otherKey: Secret;
  /** The wallets as custody names them. */
  readonly wallets: readonly string[];
  /** The signer a check removes. */
  readonly signer: string;
  /** The signer every wallet keeps. */
  readonly kept: string;
  /** A wallet id custody does not hold. */
  readonly unknownWallet: string;
  /** A wallet's signers as custody holds them now. */
  signersOf(wallet: string): Promise<readonly string[]>;
}

/** Makes a fresh subject for each check. */
export interface SignerRevokerHarness {
  create(): Promise<SignerRevokerSubject>;
}

async function signersOfAll(
  subject: SignerRevokerSubject,
): Promise<readonly (readonly string[])[]> {
  return Promise.all(subject.wallets.map(async (wallet) => subject.signersOf(wallet)));
}

async function removesTheSigner(subject: SignerRevokerSubject): Promise<void> {
  const { revoker, wallets, signer, ownerKey, kept } = subject;
  assert.deepEqual(await revoker.revoke({ signer, wallets, ownerKey }, live()), ok(wallets));
  assert.deepEqual(
    await signersOfAll(subject),
    wallets.map(() => [kept]),
  );
}

async function refusesAndChangesNothing(subject: SignerRevokerSubject): Promise<void> {
  const { revoker, wallets, signer, ownerKey, otherKey, unknownWallet, kept } = subject;
  const before = await signersOfAll(subject);
  const byOther = { signer, wallets, ownerKey: otherKey };
  assert.deepEqual(await revoker.revoke(byOther, live()), err("bad_owner_key"));
  const unknown = { signer, wallets: [...wallets, unknownWallet], ownerKey };
  assert.deepEqual(await revoker.revoke(unknown, live()), err("not_found"));
  const nobody = { signer: `${signer}-unknown`, wallets, ownerKey };
  assert.deepEqual(await revoker.revoke(nobody, live()), err("not_signer"));
  assert.deepEqual(await signersOfAll(subject), before);
  await revoker.revoke({ signer, wallets, ownerKey }, live());
  const last = { signer: kept, wallets, ownerKey };
  assert.deepEqual(await revoker.revoke(last, live()), err("last_signer"));
  assert.deepEqual(
    await signersOfAll(subject),
    wallets.map(() => [kept]),
  );
}

async function refusesAborted(subject: SignerRevokerSubject): Promise<void> {
  const { revoker, wallets, signer, ownerKey } = subject;
  await assertRefusesAborted(async (call) => revoker.revoke({ signer, wallets, ownerKey }, call));
}

/** The contract every {@link SignerRevoker} adapter passes. */
export function signerRevokerContract(harness: SignerRevokerHarness): readonly ContractCheck[] {
  const create = async (): Promise<SignerRevokerSubject> => harness.create();
  return [
    checkOn("removes the signer from every wallet and keeps the other", create, removesTheSigner),
    checkOn(
      "refuses another key, an unknown wallet, a signer none lists and the last signer",
      create,
      refusesAndChangesNothing,
    ),
    checkOn("refuses a call on an aborted signal", create, refusesAborted),
  ];
}
