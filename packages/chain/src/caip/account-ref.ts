import { type Brand, err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { assertChainRef } from "./assert-chain-ref.js";
import { type ChainRef, chainRefGrammar } from "./chain-ref.js";

/** A CAIP-10 account id: a chain id and an address on it. Wallet queues key on it. */
export type AccountRef = Brand<string, "AccountRef">;

/** The two parts of an {@link AccountRef}. */
export interface AccountRefParts {
  readonly chain: ChainRef;
  /** The address as the family writes it: 1 to 128 of `[-.%a-zA-Z0-9]`. */
  readonly address: string;
}

const accountRefPattern = new RegExp(`^${chainRefGrammar}:[-.%a-zA-Z0-9]{1,128}$`);

/** Whether a text is a well-formed CAIP-10 account id. */
export function isAccountRef(text: string): text is AccountRef {
  return accountRefPattern.test(text);
}

/** Parses a CAIP-10 account id. A malformed text is an expected failure, never a throw. */
export function parseAccountRef(text: string): Result<AccountRef, "malformed_account_ref"> {
  return isAccountRef(text) ? ok(text) : err("malformed_account_ref");
}

/** Prints an account id from its parts; parts that break the grammar are an expected failure. */
export function printAccountRef(
  parts: AccountRefParts,
): Result<AccountRef, "malformed_account_ref"> {
  return parseAccountRef(`${parts.chain}:${parts.address}`);
}

/** Splits an account id into its chain and its address. */
export function accountRefParts(ref: AccountRef): AccountRefParts {
  const separator = ref.lastIndexOf(":");
  return { chain: assertChainRef(ref.slice(0, separator)), address: ref.slice(separator + 1) };
}

/** Parses a CAIP-10 account id at a boundary. */
export const accountRefSchema: z.ZodType<AccountRef, string> = z
  .string()
  .refine(isAccountRef, { message: "Expected a CAIP-10 account id." });
