import type { AccountRef } from "../caip/account-ref.js";

/**
 * What an address's reverse record names, as a name resolver read it: this name (`matches`),
 * another name (`differs`, with the record's own text), or none. Whoever controls the address sets
 * its reverse record, so `other` is unconfirmed text: a surface escapes it before showing it.
 */
export type ReverseRecord =
  | { readonly kind: "matches" }
  | { readonly kind: "differs"; readonly other: string }
  | { readonly kind: "none" };

/** A name that points to an address holding no code, on the resolver's chain. */
export interface NameFound {
  readonly kind: "found";
  /** The name in its normalized form, which is what was resolved. */
  readonly name: string;
  readonly address: AccountRef;
  /** What the address's reverse record names; absent when its resolver gave no readable answer. */
  readonly reverse?: ReverseRecord;
}

/**
 * A name that points to no address: no resolver, no address record, the zero address, or a
 * registration that expired.
 */
export interface NameNotFound {
  readonly kind: "not_found";
  readonly name: string;
}

/** A name that points to an address holding code: a send by name pays a person, never a contract. */
export interface NameOfContract {
  readonly kind: "contract";
  readonly name: string;
  readonly address: AccountRef;
}

/** Text that is no name the resolver reads: another suffix, or one that does not normalize. */
export interface NameMalformed {
  readonly kind: "malformed";
}

/** What a name resolver answers for one name at the chain's latest block. */
export type NameResolution = NameFound | NameNotFound | NameOfContract | NameMalformed;
