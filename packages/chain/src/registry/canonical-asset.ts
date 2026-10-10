import { err, ok, type Result } from "@binference/core";
import { type AssetRef, assetRefParts, printAssetRef } from "../caip/asset-ref.js";
import type { ChainRegistry } from "../ports.js";

/**
 * The asset in its chain family's canonical form, on a chain the registry holds, so two spellings
 * of one token compare equal: a token of the family's token namespace takes its address as the
 * family writes it, and the chain's native coin stays as the registry writes it. Any other asset,
 * a chain the registry lacks, or an address its family cannot read, is `unknown_asset`.
 */
export function canonicalAsset(
  chains: ChainRegistry,
  asset: AssetRef,
): Result<AssetRef, "unknown_asset"> {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const registered = chains.get(chain);
  if (!registered.ok) {
    return err("unknown_asset");
  }
  const { family, definition } = registered.value;
  const native = definition.nativeAsset;
  if (assetNamespace === native.assetNamespace && assetReference === native.assetReference) {
    return ok(asset);
  }
  const address =
    assetNamespace === family.tokenNamespace ? family.parseAddress(assetReference) : undefined;
  const printed =
    address?.ok === true
      ? printAssetRef({ chain, assetNamespace, assetReference: address.value })
      : undefined;
  return printed?.ok === true ? ok(printed.value) : err("unknown_asset");
}
