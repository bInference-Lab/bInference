import { type AccountRef, accountRefParts } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import type { EvmChain } from "../evm-chain.js";

/**
 * The address of an account of `chain`, as a node takes it. An account of another chain, or one
 * that is no EVM address, is a `chain.unknown_chain` fault: a reader of one chain reads only its
 * accounts.
 */
export function accountAddressOn(chain: EvmChain, account: AccountRef): Address {
  const { chain: accountChain, address } = accountRefParts(account);
  const parsed = parseEvmAddress(address);
  if (accountChain !== chain.ref || !parsed.ok) {
    throw new BinferenceError({
      code: "chain.unknown_chain",
      message: `This reader reads accounts on ${chain.name} only.`,
      details: { chain: accountChain },
    });
  }
  return parsed.value;
}
