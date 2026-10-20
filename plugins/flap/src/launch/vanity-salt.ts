import { createHash } from "node:crypto";
import { BinferenceError, type Random } from "@binference/plugin-sdk";
import {
  type Address,
  bytesToHex,
  concat,
  getAddress,
  getContractAddress,
  type Hex,
  hexToBytes,
  keccak256,
} from "viem";

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

// One try in 65,536 ends in 7777, so 2^21 tries miss one with a chance of about 1 in 10^14. Node's
// own Keccak-256 runs about 2 million tries a second: a search takes some 30 ms on average and at
// most about a second, short enough to run in one go.
const mostTries = 2_097_152;

// Counts the salt's last 8 bytes up by one, in place.
function countUp(salt: Uint8Array): void {
  for (let at = salt.length - 1; at >= salt.length - 8; at -= 1) {
    const next = ((salt[at] ?? 0) + 1) & 0xff;
    salt.set([next], at);
    if (next !== 0) {
      return;
    }
  }
}

// The CREATE2 input `0xff . portal . salt . creationHash`, whose hash's last 20 bytes are the
// address; the salt is its bytes 21 to 52.
function inputOf(maker: TokenMaker, start: Uint8Array): Uint8Array {
  const input = new Uint8Array(85);
  input.set([0xff], 0);
  input.set(hexToBytes(maker.portal), 1);
  input.set(start, 21);
  input.set(hexToBytes(creationHash(maker)), 53);
  return input;
}

function endsInSuffix(hash: Buffer): boolean {
  return hash[30] === suffix[0] && hash[31] === suffix[1];
}

/**
 * Finds a salt whose tax token ends in 7777, off line: it counts up from 32 random bytes and hashes
 * each candidate as CREATE2 does. None in {@link mostTries} tries, which does not happen in
 * practice, throws `flap.no_salt`; an aborted signal throws its reason before the search starts.
 */
export function findTaxTokenSalt(
  maker: TokenMaker,
  options: { readonly random: Random; readonly signal: AbortSignal },
): FoundSalt {
  options.signal.throwIfAborted();
  const input = inputOf(maker, options.random.bytes(32));
  const salt = input.subarray(21, 53);
  for (let tries = 0; tries < mostTries; tries += 1) {
    const hash = createHash("keccak-256").update(input).digest();
    if (endsInSuffix(hash)) {
      return { salt: bytesToHex(salt), token: getAddress(bytesToHex(hash.subarray(12))) };
    }
    countUp(salt);
  }
  throw new BinferenceError({
    code: "flap.no_salt",
    message: "No salt gives a Flap tax token address ending in 7777; launch again.",
  });
}
