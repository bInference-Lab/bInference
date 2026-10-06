import { type Brand, err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { assertChainRef } from "./assert-chain-ref.js";
import { type ChainRef, chainRefGrammar } from "./chain-ref.js";

/** A CAIP-19 asset type: a chain id, an asset namespace and a reference, such as a token. */
export type AssetRef = Brand<string, "AssetRef">;

/** The three parts of an {@link AssetRef}. */
export interface AssetRefParts {
  readonly chain: ChainRef;
  /** The kind of asset on the chain: 3 to 8 of `[-a-z0-9]`. */
  readonly assetNamespace: string;
  /** The asset within that kind: 1 to 128 of `[-.%a-zA-Z0-9]`. */
  readonly assetReference: string;
}

const assetRefPattern = new RegExp(`^${chainRefGrammar}/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}$`);

/** Whether a text is a well-formed CAIP-19 asset type. */
export function isAssetRef(text: string): text is AssetRef {
  return assetRefPattern.test(text);
}

/** Parses a CAIP-19 asset type. A malformed text is an expected failure, never a throw. */
export function parseAssetRef(text: string): Result<AssetRef, "malformed_asset_ref"> {
  return isAssetRef(text) ? ok(text) : err("malformed_asset_ref");
}

/** Prints an asset type from its parts; parts that break the grammar are an expected failure. */
export function printAssetRef(parts: AssetRefParts): Result<AssetRef, "malformed_asset_ref"> {
  return parseAssetRef(`${parts.chain}/${parts.assetNamespace}:${parts.assetReference}`);
}

/** Splits an asset type into its chain, asset namespace and asset reference. */
export function assetRefParts(ref: AssetRef): AssetRefParts {
  const slash = ref.indexOf("/");
  const colon = ref.indexOf(":", slash);
  return {
    chain: assertChainRef(ref.slice(0, slash)),
    assetNamespace: ref.slice(slash + 1, colon),
    assetReference: ref.slice(colon + 1),
  };
}

/** Parses a CAIP-19 asset type at a boundary. */
export const assetRefSchema: z.ZodType<AssetRef, string> = z
  .string()
  .refine(isAssetRef, { message: "Expected a CAIP-19 asset type." });
