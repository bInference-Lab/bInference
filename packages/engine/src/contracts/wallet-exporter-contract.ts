import assert from "node:assert/strict";
import { err, type Secret } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { WalletExporter } from "../install/ports.js";
import type { SealedKey } from "../install/wallet-export.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/** A recipient key a check makes: its public half to send, and what opens a key sealed to it. */
export interface ExportRecipient {
  readonly publicKey: string;
  /** The text sealed to this key; rejects for a key sealed to another. */
  open(sealed: SealedKey): Promise<string>;
}

/** A wallet exporter under test, a wallet it holds and the keys a check uses. */
export interface WalletExporterSubject {
  readonly exporter: WalletExporter;
  /** The code of the owner key that owns the wallet. */
  readonly ownerKey: Secret;
  /** A well-formed code of another key. */
  readonly otherKey: Secret;
  /** The wallet as custody names it. */
  readonly wallet: string;
  /** A wallet id custody does not hold. */
  readonly unknownWallet: string;
  /** Whether a text is the wallet's private key, as an opened export should be. */
  isWalletKey(text: string): boolean;
  /** A fresh recipient key on each call. */
  recipient(): Promise<ExportRecipient>;
}

/** Makes a fresh subject for each check. */
export interface WalletExporterHarness {
  create(): Promise<WalletExporterSubject>;
}

function requestOf(
  subject: WalletExporterSubject,
  recipient: ExportRecipient,
  change: { readonly ownerKey?: Secret; readonly wallet?: string } = {},
) {
  return {
    wallet: change.wallet ?? subject.wallet,
    ownerKey: change.ownerKey ?? subject.ownerKey,
    recipientPublicKey: recipient.publicKey,
  };
}

async function sealsTheKey(subject: WalletExporterSubject): Promise<void> {
  const recipient = await subject.recipient();
  const sealed = await subject.exporter.exportSealed(requestOf(subject, recipient), live());
  assert.ok(sealed.ok);
  assert.ok(subject.isWalletKey(await recipient.open(sealed.value)));
  const other = await subject.recipient();
  await assert.rejects(other.open(sealed.value));
}

async function sealsEachExportApart(subject: WalletExporterSubject): Promise<void> {
  const recipient = await subject.recipient();
  const first = await subject.exporter.exportSealed(requestOf(subject, recipient), live());
  const second = await subject.exporter.exportSealed(requestOf(subject, recipient), live());
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.value.encapsulatedKey, second.value.encapsulatedKey);
}

async function refusesOthers(subject: WalletExporterSubject): Promise<void> {
  const recipient = await subject.recipient();
  const { exporter, otherKey, unknownWallet } = subject;
  const byOther = requestOf(subject, recipient, { ownerKey: otherKey });
  assert.deepEqual(await exporter.exportSealed(byOther, live()), err("bad_owner_key"));
  const unknown = requestOf(subject, recipient, { wallet: unknownWallet });
  assert.deepEqual(await exporter.exportSealed(unknown, live()), err("not_found"));
  const noKey = { ...requestOf(subject, recipient), recipientPublicKey: "AAAA" };
  assert.deepEqual(await exporter.exportSealed(noKey, live()), err("bad_recipient_key"));
}

async function refusesAborted(subject: WalletExporterSubject): Promise<void> {
  const request = requestOf(subject, await subject.recipient());
  await assertRefusesAborted(async (call) => subject.exporter.exportSealed(request, call));
}

/** The contract every {@link WalletExporter} adapter passes. */
export function walletExporterContract(harness: WalletExporterHarness): readonly ContractCheck[] {
  const create = async (): Promise<WalletExporterSubject> => harness.create();
  return [
    checkOn("seals the wallet's key so only the recipient key opens it", create, sealsTheKey),
    checkOn("seals each export apart, with a key of its own", create, sealsEachExportApart),
    checkOn(
      "refuses another key, an unknown wallet and a recipient key that is none",
      create,
      refusesOthers,
    ),
    checkOn("refuses a call on an aborted signal", create, refusesAborted),
  ];
}
