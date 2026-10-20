import { BinferenceError, type Random } from "@binference/plugin-sdk";
import { findCreate2Salt } from "@binference/plugin-sdk/evm";
import { type Address, concat, getContractAddress, type Hex, keccak256 } from "viem";

// Flap's Portal makes each token with CREATE2 as a minimal proxy of the token type's
// implementation, and takes a tax token only at an address that ends in 7777 (Flap's developer
// docs, "Find the salt"). The proxy's creation code, around the implementation's address:
const proxyHead: Hex = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73";
const proxyTail: Hex = "0x5af43d82803e903d91602b57fd5bf3";
// The address's last two bytes, `7777`.
const suffix = [0x77, 0x77] as const;

/** The Portal that makes a token, and the implementation the token is a proxy of. */
export interface TokenMaker {
  readonly portal: Address;
  readonly implementation: Address;
}

/** The hash of the token's creation code, which its address commits to. */
function creationHash(maker: TokenMaker): Hex {
  return keccak256(concat([proxyHead, maker.implementation, proxyTail]));
}

/** The address the Portal gives a token launched with `salt`. */
export function tokenAddressOf(maker: TokenMaker, salt: Hex): Address {
  return getContractAddress({
    opcode: "CREATE2",
    from: maker.portal,
    salt,
    bytecodeHash: creationHash(maker),
  });
}

/** Whether a token at the address is one the Portal takes as a tax token's. */
export function isTaxTokenAddress(token: Address): boolean {
  return token.toLowerCase().endsWith("7777");
}

/** A salt and the tax token's address it gives. */
export interface FoundSalt {
  readonly salt: Hex;
  readonly token: Address;
}

/**
 * Finds a salt whose tax token ends in 7777, off line, as {@link findCreate2Salt} searches. None
 * found, which does not happen in practice, throws `flap.no_salt`; an aborted signal rejects with
 * its reason at the next turn.
 */
export async function findTaxTokenSalt(
  maker: TokenMaker,
  options: { readonly random: Random; readonly signal: AbortSignal },
): Promise<FoundSalt> {
  const search = { deployer: maker.portal, initCodeHash: creationHash(maker), suffix };
  const found = await findCreate2Salt(search, options);
  if (found === undefined) {
    throw new BinferenceError({
      code: "flap.no_salt",
      message: "No salt gives a Flap tax token address ending in 7777; launch again.",
    });
  }
  return { salt: found.salt, token: found.address };
}
