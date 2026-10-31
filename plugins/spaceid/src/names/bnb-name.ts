import { type Address, type Hex, labelhash, namehash } from "viem";
import { normalize } from "viem/ens";

/** The suffix of every name the plugin resolves: SPACE ID's `.bnb` top-level domain. */
export const bnbSuffix = ".bnb";

/** A `.bnb` name, normalized, with the hashes its reads take. */
export interface BnbName {
  /** The name after ENSIP-15 normalization, such as `alice.bnb`. */
  readonly name: string;
  /** Its EIP-137 namehash: the registry's and the resolver's key. */
  readonly node: Hex;
  /** The labelhash of its second-level label: the base registrar's token id for its expiry. */
  readonly registration: Hex;
}

// ENSIP-15 normalization, which throws on text it refuses.
function normalized(text: string): string | undefined {
  try {
    return normalize(text);
  } catch {
    return undefined;
  }
}

/**
 * Reads text as a `.bnb` name: normalized as SPACE ID normalizes names before it hashes them
 * (ENSIP-15), then one or more labels before `.bnb`. Text that does not normalize, ends in another
 * suffix or names `bnb` alone is `undefined`.
 */
export function bnbNameOf(text: string): BnbName | undefined {
  const name = normalized(text);
  const labels = name?.split(".") ?? [];
  const secondLevel = labels.at(-2);
  if (name === undefined || labels.at(-1) !== "bnb" || secondLevel === undefined) {
    return undefined;
  }
  if (labels.some((label) => label === "")) {
    return undefined;
  }
  return { name, node: namehash(name), registration: labelhash(secondLevel) };
}

/**
 * The namehash of an address's reverse record: `<address in lowercase hex, no 0x>.addr.reverse`,
 * as EIP-181 names it.
 */
export function reverseNodeOf(address: Address): Hex {
  return namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
}

/** Whether a reverse record's text names `name`, once normalized as a name is. */
export function namesSame(text: string, name: string): boolean {
  return normalized(text) === name;
}
