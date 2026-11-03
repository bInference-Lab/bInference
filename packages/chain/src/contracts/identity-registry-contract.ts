import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { IdentityRegistry } from "../identity/ports.js";
import { type RegistrationCard, registrationFileMaxLength } from "../identity/registration.js";
import type { SimulatedStep } from "../simulation/simulated-step.js";
import type { TxDraft, TxHash } from "../transaction.js";

/**
 * An identity registry under test: `wallet` holds no identity of it and can pay for a
 * registration, `other` is another wallet of its chain, `foreign` a call from `wallet` to another
 * contract. `simulate` runs a draft unsent as the chain's simulator does, and `land` mines it.
 */
export interface IdentityRegistrySubject {
  readonly registry: IdentityRegistry;
  readonly wallet: AccountRef;
  readonly other: AccountRef;
  readonly foreign: TxDraft;
  simulate(draft: TxDraft): Promise<SimulatedStep>;
  land(draft: TxDraft): Promise<TxHash>;
}

/** Makes a fresh {@link IdentityRegistrySubject} for each check. */
export interface IdentityRegistryHarness {
  create(): Promise<IdentityRegistrySubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function cardOf(subject: IdentityRegistrySubject): RegistrationCard {
  return {
    name: "Scout",
    description: "Buys dips \u00e9\u2603",
    wallet: subject.wallet,
    version: "2026.11.3",
  };
}

function built(subject: IdentityRegistrySubject): {
  readonly file: string;
  readonly draft: TxDraft;
} {
  const file = subject.registry.fileOf(cardOf(subject));
  return { file, draft: subject.registry.build({ wallet: subject.wallet, file }) };
}

async function readsFreshWallet(harness: IdentityRegistryHarness): Promise<void> {
  const { registry, wallet } = await harness.create();
  const standing = await registry.standing(wallet, live());
  assert.deepEqual(standing, { version: registry.testedVersion, held: 0n });
  assert.equal(accountRefParts(registry.registry).chain, registry.chain);
}

async function writesFiles(harness: IdentityRegistryHarness): Promise<void> {
  const subject = await harness.create();
  const card = cardOf(subject);
  const file = subject.registry.fileOf(card);
  assert.ok(file.startsWith("data:") && file.length <= registrationFileMaxLength);
  assert.equal(subject.registry.fileOf({ ...card }), file);
  const changed: readonly RegistrationCard[] = [
    { ...card, name: "Scout 2" },
    { ...card, description: "" },
    { ...card, wallet: subject.other },
    { ...card, version: "2026.11.4" },
  ];
  for (const other of changed) {
    assert.notEqual(subject.registry.fileOf(other), file);
  }
}

async function decodesOwnBuild(harness: IdentityRegistryHarness): Promise<void> {
  const subject = await harness.create();
  const { file, draft } = built(subject);
  assert.deepEqual([draft.chain, draft.from], [subject.registry.chain, subject.wallet]);
  assert.deepEqual(subject.registry.decode(draft), { ok: true, value: { file } });
  assert.deepEqual(subject.registry.decode(subject.foreign), { ok: false, error: "unknown_call" });
}

async function mintsToWallet(harness: IdentityRegistryHarness): Promise<void> {
  const subject = await harness.create();
  const step = await subject.simulate(built(subject).draft);
  assert.equal(step.status, "success");
  assert.equal(subject.registry.minted(step, subject.wallet), 1);
  assert.equal(subject.registry.minted(step, subject.other), 0);
}

async function readsBack(harness: IdentityRegistryHarness): Promise<void> {
  const subject = await harness.create();
  const { registry, wallet, other } = subject;
  const { file, draft } = built(subject);
  const txHash = await subject.land(draft);
  const landed = await registry.landed({ wallet, txHash }, live());
  assert.ok(landed.ok);
  assert.deepEqual([landed.value.owner, landed.value.file], [wallet, file]);
  assert.match(landed.value.onchainId, /^(?:0|[1-9]\d*)$/);
  assert.equal((await registry.standing(wallet, live())).held, 1n);
  const elsewhere = await registry.landed({ wallet: other, txHash }, live());
  assert.deepEqual(elsewhere, { ok: false, error: "not_found" });
}

async function stopsOnAbort(harness: IdentityRegistryHarness): Promise<void> {
  const { registry, wallet } = await harness.create();
  const reason = new Error("stopped");
  await assert.rejects(registry.standing(wallet, { signal: AbortSignal.abort(reason) }), reason);
}

/** The contract every `IdentityRegistry` passes. */
export function identityRegistryContract(
  harness: IdentityRegistryHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "reads the version it was tested with, and no identity held by a fresh wallet",
      run: async () => readsFreshWallet(harness),
    },
    {
      name: "writes the same file for the same card, and another for any other field",
      run: async () => writesFiles(harness),
    },
    {
      name: "decodes its own call back to the file it registers, and refuses another call",
      run: async () => decodesOwnBuild(harness),
    },
    {
      name: "counts the identity token a simulated registration mints to the wallet alone",
      run: async () => mintsToWallet(harness),
    },
    {
      name: "reads back a landed registration's id, holder and file for its wallet only",
      run: async () => readsBack(harness),
    },
    { name: "refuses to read on an aborted signal", run: async () => stopsOnAbort(harness) },
  ];
}
