import type { Address } from "viem";

/**
 * A token's status as the Portal reports it: `Tradable` (1) while on its curve, `DEX` (4) once it
 * graduated to a pool. The others are a token that does not exist (0), two obsolete states (2, 3)
 * and a token whose address is set but which is not made yet (5).
 */
export const tokenStatus = { invalid: 0, tradable: 1, dex: 4 } as const;

/** What the venue reads of a token's state on the Portal. */
export interface TokenState {
  readonly status: number;
  /** The tokens sold off the curve so far, in base units. */
  readonly circulatingSupply: bigint;
  /**
   * The curve's price now: base units of the quote token for one whole token (10^18 base units).
   * Zero for a token that left its curve.
   */
  readonly price: bigint;
  /** The circulating supply at which the token leaves its curve for a pool. */
  readonly dexSupplyThresh: bigint;
  /** The token the curve trades against; the zero address for the chain's coin. */
  readonly quoteToken: Address;
  /** The tax the Portal takes on a buy on the curve, in basis points. */
  readonly buyTaxBps: bigint;
  /** The tax the Portal takes on a sale on the curve, in basis points. */
  readonly sellTaxBps: bigint;
}
