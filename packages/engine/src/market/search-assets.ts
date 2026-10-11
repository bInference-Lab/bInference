import {
  type AssetRef,
  type ChainRegistry,
  canonicalAsset,
  printAssetRef,
  type RegisteredChain,
} from "@binference/chain";
import type { AssetView, ResultOf } from "@binference/protocol";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { registryTokens } from "../positions/held-assets.js";

/** One search: the chain, the text a caller typed, and the tokens the wallets hold. */
export interface AssetQuery {
  readonly chain: RegisteredChain;
  readonly query: string;
  /** The assets the wallets hold a position in, in their family's canonical form. */
  readonly held: ReadonlySet<AssetRef>;
}

type SearchView = ResultOf<"asset/search">;

// The chain's coin and every token the registry lists, each with the registry's info.
function listedViews(chains: ChainRegistry, chain: RegisteredChain): readonly AssetView[] {
  return [nativeAssetOf(chain), ...registryTokens(chain)].flatMap((listed) => {
    const asset = canonicalAsset(chains, listed);
    const info = asset.ok ? assetInfoOf(chains, listed) : undefined;
    return asset.ok && info !== undefined ? [{ asset: asset.value, ...info }] : [];
  });
}

function viewOf(items: readonly AssetView[]): SearchView {
  return items.length > 1 ? { items, ambiguous: true } : { items };
}

// A symbol matches whole, any case; only when none does, a name that holds the text matches.
function textMatches(listed: readonly AssetView[], query: string): SearchView {
  const text = query.toLowerCase();
  const bySymbol = listed.filter((view) => view.symbol.toLowerCase() === text);
  return viewOf(
    bySymbol.length > 0
      ? bySymbol
      : listed.filter((view) => view.name.toLowerCase().includes(text)),
  );
}

/**
 * Finds the assets a query names on one chain, from the chain registry and the tokens the wallets
 * hold only, never from outside: an address the chain's family reads gives that token's canonical
 * id, with the registry's info when it lists it, else as an unlisted token that says whether a
 * wallet holds it; other text matches the registry's symbols whole, any case, or else the names
 * that hold it. More than one match is `ambiguous`, so the caller asks the owner which one.
 */
export function searchAssets(chains: ChainRegistry, search: AssetQuery): SearchView {
  const { chain, held } = search;
  const query = search.query.trim();
  const listed = listedViews(chains, chain);
  const address = chain.family.parseAddress(query);
  if (!address.ok) {
    return textMatches(listed, query);
  }
  const named = printAssetRef({
    chain: chain.ref,
    assetNamespace: chain.family.tokenNamespace,
    assetReference: address.value,
  });
  const asset = named.ok ? canonicalAsset(chains, named.value) : named;
  if (!asset.ok) {
    return { items: [] };
  }
  const found = listed.filter((view) => view.asset === asset.value);
  return found.length > 0
    ? { items: found }
    : { items: [], unlisted: [{ asset: asset.value, held: held.has(asset.value) }] };
}
