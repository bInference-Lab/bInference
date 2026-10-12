import type { AssetRef, ChainRegistry } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import { assetInfoOf } from "./asset-infos.js";

/** What a token's contract answers about itself on chain: what its deployer chose. */
export interface TokenFacts {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

/**
 * Reads tokens' facts on chain. A token that answers no symbol or no decimals is left out. Rejects
 * when its chain cannot be read, and with the signal's reason once it aborts.
 */
export type ReadTokenFacts = (
  tokens: readonly AssetRef[],
  call: { readonly signal: AbortSignal },
) => Promise<ReadonlyMap<AssetRef, TokenFacts>>;

/**
 * The info of each asset a proposal names that the registry does not list, read on chain now and
 * marked unverified: what its cards show it by (decision 0199). Nothing is read when the registry
 * lists every asset. A token that answers no symbol or no decimals is `asset.unreadable`: no card
 * could show its amounts, so nothing is proposed.
 */
export async function unlistedAssetInfos(
  parts: { readonly chains: ChainRegistry; readonly readTokenFacts: ReadTokenFacts },
  assets: readonly AssetRef[],
  signal: AbortSignal,
): Promise<Result<AssetInfos, "asset.unreadable">> {
  const unlisted = [...new Set(assets)].filter(
    (asset) => assetInfoOf(parts.chains, asset) === undefined,
  );
  if (unlisted.length === 0) {
    return ok({});
  }
  const facts = await parts.readTokenFacts(unlisted, { signal });
  const infos = unlisted.flatMap((asset) => {
    const read = facts.get(asset);
    return read === undefined ? [] : [[asset, { ...read, verified: false }] as const];
  });
  return infos.length === unlisted.length ? ok(Object.fromEntries(infos)) : err("asset.unreadable");
}
