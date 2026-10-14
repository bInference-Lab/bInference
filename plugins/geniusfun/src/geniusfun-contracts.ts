import { type AccountRef, accountRefParts, BinferenceError } from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";

/**
 * The factories of Genius.fun's live stacks, by their registry names, newest first. Each launch
 * of a stack has its own curve, which only that stack's factory names.
 */
export const stackFactoryNames: readonly string[] = ["factory-m4-2", "factory-m4-1"];

/** The one contract each launch has of its own: its curve, which trades its token. */
export const curveName = "curve";

/** One stack's factory: its registry name and its address. */
export interface StackFactory {
  readonly name: string;
  readonly address: Address;
}

function noContract(name: string): BinferenceError {
  return new BinferenceError({
    code: "geniusfun.no_contract",
    message: `The request carries no ${name}; the venue declares it on every chain.`,
    details: { name },
  });
}

/** The address of an EVM account, in checksum form; any other account is a fault. */
export function addressOf(account: AccountRef): Address {
  const address = parseEvmAddress(accountRefParts(account).address);
  if (!address.ok) {
    throw new BinferenceError({
      code: "geniusfun.not_evm",
      message: "Genius.fun trades only from and with EVM accounts.",
    });
  }
  return address.value;
}

/** Each live stack's factory among the contracts the host gave; one missing is a fault. */
export function factoriesOf(
  contracts: Readonly<Record<string, AccountRef>>,
): readonly StackFactory[] {
  return stackFactoryNames.map((name) => {
    const account = contracts[name];
    if (account === undefined) {
      throw noContract(name);
    }
    return { name, address: addressOf(account) };
  });
}

/**
 * The curve of the traded token's launch, which the host adds to a request from the venue's own
 * curve read (decision 0212); a request without one is a fault.
 */
export function curveAccountOf(contracts: Readonly<Record<string, AccountRef>>): AccountRef {
  const curve = contracts[curveName];
  if (curve === undefined) {
    throw noContract("launch's curve");
  }
  return curve;
}
