import {
  type Amount,
  type AssetRef,
  assetRefSchema,
  type RegisteredChain,
  type VenueQuote,
} from "@binference/chain";

/** The chain's own coin, as the asset the host names it by. */
export function nativeAssetOf(chain: RegisteredChain): AssetRef {
  const { assetNamespace, assetReference } = chain.definition.nativeAsset;
  return assetRefSchema.parse(`${chain.ref}/${assetNamespace}:${assetReference}`);
}

/** A frozen copy of an amount the host hands a venue. */
export function frozenAmount(amount: Amount): Amount {
  return Object.freeze({ asset: amount.asset, base: amount.base });
}

/**
 * A frozen copy of a venue's quote. What the host hands a venue is frozen, so venue code cannot
 * move the terms it is checked by.
 */
export function frozenQuote(quote: VenueQuote): VenueQuote {
  return Object.freeze({ ...quote, expectedOut: frozenAmount(quote.expectedOut) });
}
