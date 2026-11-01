import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AccountKindReader } from "../addresses/ports.js";
import type { AccountRef } from "../caip/account-ref.js";

/**
 * A reader under test, on one chain: `wallet` is a wallet's account, `fresh` an address with no
 * account yet that a key can sign for, `program` an executable program, `tokenAccount` an account
 * a program owns, `derived` an address no key can sign for, such as a program-derived address
 * with no account yet, `nonce` an account that holds data for the chain itself, such as a durable
 * nonce, and `stranger` an account of another chain.
 */
export interface AccountKindReaderSubject {
  readonly reader: AccountKindReader;
  readonly wallet: AccountRef;
  readonly fresh: AccountRef;
  readonly program: AccountRef;
  readonly tokenAccount: AccountRef;
  readonly derived: AccountRef;
  readonly nonce: AccountRef;
  readonly stranger: AccountRef;
}

/** Makes a fresh {@link AccountKindReaderSubject} for each check. */
export interface AccountKindReaderHarness {
  create(): Promise<AccountKindReaderSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function readsWallets(harness: AccountKindReaderHarness): Promise<void> {
  const { reader, wallet, fresh } = await harness.create();
  assert.equal(await reader.read(wallet, live()), "wallet");
  assert.equal(await reader.read(fresh, live()), "wallet");
}

async function readsOthers(harness: AccountKindReaderHarness): Promise<void> {
  const { reader, program, tokenAccount, derived, nonce } = await harness.create();
  for (const account of [program, tokenAccount, derived, nonce]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read at a time, as each names its account
    assert.equal(await reader.read(account, live()), "not_wallet");
  }
}

async function refusesStranger(harness: AccountKindReaderHarness): Promise<void> {
  const { reader, stranger } = await harness.create();
  await assert.rejects(reader.read(stranger, live()));
}

async function refusesAborted(harness: AccountKindReaderHarness): Promise<void> {
  const { reader, wallet } = await harness.create();
  const reason = new Error("stopped");
  await assert.rejects(reader.read(wallet, { signal: AbortSignal.abort(reason) }), reason);
}

/** The contract every `AccountKindReader` adapter passes. */
export function accountKindReaderContract(
  harness: AccountKindReaderHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "reads a wallet, and an address with no account yet, as wallets",
      run: async () => readsWallets(harness),
    },
    {
      name: "reads a program, a token account, a derived address and a nonce account as no wallet",
      run: async () => readsOthers(harness),
    },
    { name: "refuses an account of another chain", run: async () => refusesStranger(harness) },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => refusesAborted(harness),
    },
  ];
}
