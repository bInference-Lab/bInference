import type { AccountRef, ChainRef } from "@binference/chain";
import { accountRefParts } from "@binference/chain";
import type { SignerSettings } from "../process/signer-settings.schema.js";
import type { AuthorizeInput } from "../requests/authorize-input.schema.js";
import type { EvmTransaction } from "./evm-transaction.schema.js";

/** The number of a hard rule of the keys spec, section 5.2. */
export type HardRule = 1 | 2 | 3 | 4 | 5 | 6;

/** What every hard rule reads: the request, the transaction in its body, the settings and the time. */
export interface RuleView {
  readonly input: AuthorizeInput;
  readonly transaction: EvmTransaction;
  readonly settings: SignerSettings;
  /** Now, in epoch milliseconds. */
  readonly nowMs: number;
}

/** Whether an account is `address` on `chain`. EVM addresses compare without case. */
export function isAccount(
  account: AccountRef,
  chain: ChainRef,
  address: string | undefined,
): boolean {
  const parts = accountRefParts(account);
  return parts.chain === chain && parts.address.toLowerCase() === address;
}

/** Whether a list holds `address` on `chain`. */
export function listsAccount(
  accounts: readonly AccountRef[],
  chain: ChainRef,
  address: string | undefined,
): boolean {
  return accounts.some((account) => isAccount(account, chain, address));
}
