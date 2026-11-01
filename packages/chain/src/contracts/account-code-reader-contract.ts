import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AccountCodeReader } from "../addresses/ports.js";
import type { AccountRef } from "../caip/account-ref.js";

/**
 * A reader under test, on one chain: `plain` holds no code, `delegated` only a delegation,
 * `token` a token's code, `contract` other code, and `stranger` is an account of another chain.
 */
export interface AccountCodeReaderSubject {
  readonly reader: AccountCodeReader;
  readonly plain: AccountRef;
  readonly delegated: AccountRef;
  readonly token: AccountRef;
  readonly contract: AccountRef;
  readonly stranger: AccountRef;
}

/** Makes a fresh {@link AccountCodeReaderSubject} for each check. */
export interface AccountCodeReaderHarness {
  create(): Promise<AccountCodeReaderSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function readsEachKind(harness: AccountCodeReaderHarness): Promise<void> {
  const { reader, plain, delegated, token, contract } = await harness.create();
  const read = await Promise.all(
    [plain, delegated, token, contract].map(async (account) => reader.read(account, live())),
  );
  assert.deepEqual(read, ["none", "delegation", "token", "contract"]);
}

async function refusesStranger(harness: AccountCodeReaderHarness): Promise<void> {
  const { reader, stranger } = await harness.create();
  await assert.rejects(reader.read(stranger, live()));
}

async function refusesAborted(harness: AccountCodeReaderHarness): Promise<void> {
  const { reader, plain } = await harness.create();
  const reason = new Error("stopped");
  await assert.rejects(reader.read(plain, { signal: AbortSignal.abort(reason) }), reason);
}

/** The contract every `AccountCodeReader` adapter passes. */
export function accountCodeReaderContract(
  harness: AccountCodeReaderHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "reads no code, a delegation, a token and other code apart",
      run: async () => readsEachKind(harness),
    },
    { name: "refuses an account of another chain", run: async () => refusesStranger(harness) },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => refusesAborted(harness),
    },
  ];
}
