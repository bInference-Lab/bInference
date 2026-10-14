import type { AccountRef, ChainRef } from "@binference/plugin-sdk";
import type { CurveChainSetup } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { BoundedMemo } from "./launch/bounded-memo.js";

/** The facts of one launch that never change: its token and what its curve trades it against. */
export interface LaunchFacts {
  readonly token: Address;
  /** The zero address for the chain's coin. */
  readonly pairToken: Address;
}

/** A curve as the venue's memos key it: by its chain and its address, as one curve per chain. */
export type CurveKey = `${ChainRef}|${Address}`;

/** The key of a curve of a chain in the venue's memos. */
export function curveKeyOf(chain: ChainRef, curve: Address): CurveKey {
  return `${chain}|${curve}`;
}

/** What the venue's reads, quote, build and decoder share. */
export interface VenueParts {
  readonly setups: ReadonlyMap<ChainRef, CurveChainSetup>;
  /**
   * The launch of each curve the venue read on a stack's factory, by the curve's chain and
   * address: what the decoder reads a trade call's assets from.
   */
  readonly launches: BoundedMemo<CurveKey, LaunchFacts>;
  /** The insiders read for each launch's curve, which never change once it launched. */
  readonly insiders: BoundedMemo<CurveKey, readonly AccountRef[]>;
}
