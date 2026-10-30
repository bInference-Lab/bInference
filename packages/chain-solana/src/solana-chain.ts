import {
  type AccountRef,
  accountRefParts,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  type ChainDefinition,
  type ChainRef,
  chainRefParts,
  chainRefSchema,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "@solana/kit";
import { parseSolanaAddress } from "./solana-address.js";
import { solanaFamilyId, solanaNamespace, solanaTokenNamespace } from "./solana-ids.js";

/** What the Solana family reads from a chain definition. */
export interface SolanaChain {
  /** The CAIP-2 id: the namespace and the first 32 characters of the cluster's genesis hash. */
  readonly ref: ChainRef;
  readonly name: string;
  /** SOL as a CAIP-19 asset type. */
  readonly nativeAsset: AssetRef;
}

function refuse(definition: ChainDefinition, problem: string): BinferenceError {
  return new BinferenceError({
    code: "chain.not_solana",
    message: `The chain ${definition.key} is not a Solana chain: ${problem}`,
    details: { chain: definition.key },
  });
}

/**
 * Reads the Solana view of a chain definition. A definition of another family, or whose CAIP-2 id
 * is not in the `solana` namespace, is a fault.
 */
export function solanaChainOf(definition: ChainDefinition): SolanaChain {
  if (definition.family !== solanaFamilyId) {
    throw refuse(definition, `its family is ${definition.family}.`);
  }
  const ref = chainRefSchema.safeParse(definition.id);
  if (!ref.success || chainRefParts(ref.data).namespace !== solanaNamespace) {
    throw refuse(definition, `its id ${definition.id} is not in the solana namespace.`);
  }
  const { assetNamespace, assetReference } = definition.nativeAsset;
  return {
    ref: ref.data,
    name: definition.name,
    nativeAsset: assetRefSchema.parse(`${ref.data}/${assetNamespace}:${assetReference}`),
  };
}

function notServed(chain: SolanaChain, details: Readonly<Record<string, string>>): BinferenceError {
  return new BinferenceError({
    code: "chain.unknown_chain",
    message: `This reader reads ${chain.name} only.`,
    details,
  });
}

/**
 * The address of an account of `chain`. An account of another chain, or one that is no Solana
 * address, is a `chain.unknown_chain` fault: a reader of one chain reads only its accounts.
 */
export function solanaAddressOn(chain: SolanaChain, account: AccountRef): Address {
  const { chain: accountChain, address } = accountRefParts(account);
  const parsed = parseSolanaAddress(address);
  if (accountChain !== chain.ref || !parsed.ok) {
    throw notServed(chain, { chain: accountChain });
  }
  return parsed.value;
}

/**
 * The mint of an SPL token of `chain`, or `undefined` for SOL. An asset of another chain or kind
 * is a `chain.unknown_chain` fault.
 */
export function solanaMintOn(chain: SolanaChain, asset: AssetRef): Address | undefined {
  if (asset === chain.nativeAsset) {
    return undefined;
  }
  const { chain: assetChain, assetNamespace, assetReference } = assetRefParts(asset);
  const mint = parseSolanaAddress(assetReference);
  if (assetChain !== chain.ref || assetNamespace !== solanaTokenNamespace || !mint.ok) {
    throw notServed(chain, { asset });
  }
  return mint.value;
}
