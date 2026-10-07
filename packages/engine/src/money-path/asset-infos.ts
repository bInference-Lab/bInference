import { type AssetRef, assetRefParts, type ChainRegistry } from "@binference/chain";
import type { AssetInfo, AssetInfos } from "@binference/protocol";

/**
 * What the chain registry says about an asset: its chain's native coin, or a token it lists, both
 * verified. An asset on a chain the registry does not hold, or a token it does not list, is
 * `undefined`: the risk step treats it as unknown.
 */
export function assetInfoOf(chains: ChainRegistry, asset: AssetRef): AssetInfo | undefined {
  const parts = assetRefParts(asset);
  const chain = chains.get(parts.chain);
  if (!chain.ok) {
    return undefined;
  }
  const { nativeAsset, tokens } = chain.value.definition;
  const isNative = parts.assetNamespace === nativeAsset.assetNamespace;
  // A token never shares the native coin's namespace, such as `slip44`.
  const listed = isNative
    ? [nativeAsset].find((native) => native.assetReference === parts.assetReference)
    : tokens.find((token) => token.address === parts.assetReference);
  return listed === undefined
    ? undefined
    : { symbol: listed.symbol, name: listed.name, decimals: listed.decimals, verified: true };
}

/** The registry's info for each asset it knows, keyed by asset, for a view's `assets`. */
export function assetInfosOf(chains: ChainRegistry, assets: readonly AssetRef[]): AssetInfos {
  return Object.fromEntries(
    assets.flatMap((asset) => {
      const info = assetInfoOf(chains, asset);
      return info === undefined ? [] : [[asset, info]];
    }),
  );
}
