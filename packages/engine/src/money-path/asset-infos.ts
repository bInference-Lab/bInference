import { type AssetRef, assetRefParts, type ChainRegistry } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import type { AssetInfo, AssetInfos } from "@binference/protocol";
import { assetsDocument, requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import type { IntentStore } from "../ports.js";

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

/** Where a view finds what it shows of each asset: the registry, then the stored intents. */
export interface AssetSources {
  readonly chains: ChainRegistry;
  readonly intents: Pick<IntentStore, "storedAssets">;
}

/**
 * The info of each asset a view names: the registry's, else what the newest intent stored of a
 * token the registry does not list when it was proposed, marked unverified (decision 0199). An
 * asset neither knows is left out, and the view shows it by its address.
 */
export async function knownAssetInfos(
  sources: AssetSources,
  assets: readonly AssetRef[],
  call: { readonly signal: AbortSignal },
): Promise<AssetInfos> {
  const listed = assetInfosOf(sources.chains, assets);
  const unlisted = [...new Set(assets)].filter((asset) => listed[asset] === undefined);
  if (unlisted.length === 0) {
    return listed;
  }
  return { ...(await sources.intents.storedAssets(unlisted, call)), ...listed };
}

// A token launch names the token its create call makes, which no registry lists and no proposal
// stored: its name and symbol are the launch's own, and its decimals its launchpad's quote.
function launchedInfos(
  record: Partial<Pick<IntentRecord, "kind" | "request" | "quote">>,
): AssetInfos {
  const { kind, request: stored } = record;
  const request =
    kind === "launchToken" && stored !== undefined ? requestDocument.decode(stored) : undefined;
  if (request?.kind !== "launchToken" || record.quote === undefined) {
    return {};
  }
  const { token, tokenDecimals } = tokenLaunchQuoteDocument.decode(record.quote);
  const info = { symbol: request.symbol, name: request.name, decimals: tokenDecimals };
  return { [token]: { ...info, verified: false, onCurve: true } };
}

/**
 * The info of each asset an intent names: the registry's, else what the intent stored of a token
 * the registry does not list when it was proposed, marked unverified, or, for a token launch, the
 * launched token's own words. An asset none knows is left out.
 */
export function intentAssetInfos(
  chains: ChainRegistry,
  record: Pick<IntentRecord, "assets"> & Partial<Pick<IntentRecord, "kind" | "request" | "quote">>,
  assets: readonly AssetRef[],
): AssetInfos {
  const stored = {
    ...launchedInfos(record),
    ...(record.assets === undefined ? {} : assetsDocument.decode(record.assets)),
  };
  return Object.fromEntries(
    [...new Set(assets)].flatMap((asset) => {
      const info = assetInfoOf(chains, asset) ?? stored[asset];
      return info === undefined ? [] : [[asset, info]];
    }),
  );
}

/**
 * The info of each asset that intents stored at their proposal (decision 0199), from their
 * `assets` documents, the newest intent's first: the first document that holds an asset gives
 * its info. An asset no document holds is left out.
 */
export function newestAssetInfos(
  documents: readonly JsonValue[],
  assets: readonly AssetRef[],
): AssetInfos {
  const found = new Map<AssetRef, AssetInfo>();
  for (const document of documents) {
    const stored = assetsDocument.decode(document);
    for (const asset of assets) {
      const info = stored[asset];
      if (info !== undefined && !found.has(asset)) {
        found.set(asset, info);
      }
    }
  }
  return Object.fromEntries(found);
}

/** {@link newestAssetInfos} over intents as stored: the newest intent first, by creation then id. */
export function newestStoredAssets(
  intents: readonly Pick<IntentRecord, "id" | "createdAtMs" | "assets">[],
  assets: readonly AssetRef[],
): AssetInfos {
  const newestFirst = intents.toSorted(
    (left, right) => right.createdAtMs - left.createdAtMs || (left.id < right.id ? 1 : -1),
  );
  return newestAssetInfos(
    newestFirst.flatMap(({ assets: stored }) => (stored === undefined ? [] : [stored])),
    assets,
  );
}
