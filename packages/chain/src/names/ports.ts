import type { ChainRef } from "../caip/chain-ref.js";
import type { NameResolution } from "./name-resolution.js";

/**
 * Resolves names under one suffix, such as a naming service's top-level domain, to accounts of
 * one chain: the address record of the name at the chain's latest block, and what that address's
 * reverse record names. It reads the chain on every call and keeps nothing, so a name read again
 * after its record changed answers the new address; a send by name reads it once for its card and
 * again before it signs. Adapters: naming-service plugins over the chain's RPC failover.
 */
export interface NameResolver {
  /** The chain whose accounts it answers. */
  readonly chain: ChainRef;
  /** The suffix of every name it resolves, with its leading dot, in lowercase. */
  readonly suffix: string;
  /**
   * What the name points to now. Text under another suffix, or that does not normalize, is
   * `malformed`; every other answer carries the name normalized. Rejects when the chain does not
   * answer or answers outside the shape it reads, and with the signal's reason once it aborts.
   */
  resolve(name: string, options: { readonly signal: AbortSignal }): Promise<NameResolution>;
}
