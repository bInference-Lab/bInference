import {
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  type RegisteredChain,
} from "@binference/chain";
import type { Id } from "@binference/core";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { PositionStore } from "../ports.js";

// The registry's tokens of the chain, as assets of its family's token standard.
function registryTokens(chain: RegisteredChain): readonly AssetRef[] {
  const { tokenNamespace } = chain.family;
  return chain.definition.tokens.map((token) =>
    assetRefSchema.parse(`${chain.ref}/${tokenNamespace}:${token.address}`),
  );
}

/**
 * The assets to look for in a live wallet on `chain`, each once: the chain's coin, every token the
 * registry lists and every asset of the chain the wallet holds a live position in. A token known
 * to none of these is not looked for.
 */
export async function heldAssetsOf(
  store: PositionStore,
  wallet: Id<"wal">,
  call: { readonly chain: RegisteredChain; readonly signal: AbortSignal },
): Promise<readonly AssetRef[]> {
  const { chain, signal } = call;
  const held = await store.positions({ walletId: wallet, isPaper: false }, { signal });
  const positioned = held
    .map(({ asset }) => asset)
    .filter((asset) => assetRefParts(asset).chain === chain.ref);
  return [...new Set([nativeAssetOf(chain), ...registryTokens(chain), ...positioned])];
}
