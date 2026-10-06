import type { AssetRef, ChainRef } from "@binference/chain";
import type { Ratio } from "@binference/core";

/** A new block of a chain, as the watchers read it. */
export interface BlockReading {
  readonly chain: ChainRef;
  readonly number: bigint;
  readonly atMs: number;
}

/** An asset's USD price at one moment. */
export interface PriceReading {
  readonly asset: AssetRef;
  /** Micro-dollars per base unit, as a `UsdPrice`: above zero, with a denominator above zero. */
  readonly price: Ratio;
  readonly atMs: number;
}
