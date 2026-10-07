import { bsc } from "@binference/chains";
import { BinferenceError } from "@binference/core";
import { type Address, getAddress } from "viem";

function found(entry: { readonly address: string } | undefined, name: string): Address {
  if (entry === undefined) {
    throw new BinferenceError({
      code: "fork.unknown_address",
      message: `The BSC registry has no ${name}.`,
      details: { name },
    });
  }
  return getAddress(entry.address);
}

/** A token's address from the BSC registry in `@binference/chains`, so fork tests name no hex. */
export function bscToken(symbol: string): Address {
  return found(
    bsc.tokens.find((token) => token.symbol === symbol),
    symbol,
  );
}

/** A venue contract's address from the BSC registry in `@binference/chains`. */
export function bscContract(venue: string, name: string): Address {
  return found(
    bsc.contracts.find((contract) => contract.venue === venue && contract.name === name),
    `${venue} ${name}`,
  );
}
