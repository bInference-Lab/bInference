import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type ChainDefinition,
  type ChainRef,
  chainRefParts,
  chainRefSchema,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "viem";
import { z } from "zod";
import { evmFamilyId, evmNamespace } from "./evm-ids.js";

/** What the EVM family reads from a chain definition. */
export interface EvmChain {
  /** The CAIP-2 id, such as the definition's `id`. */
  readonly ref: ChainRef;
  /** The EIP-155 chain id that transactions carry. */
  readonly chainId: number;
  readonly name: string;
  /** The chain's own coin as a CAIP-19 asset type. */
  readonly nativeAsset: AssetRef;
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
}

const chainIdPattern = /^[1-9][0-9]{0,14}$/;
const chainIdSchema = z.coerce.number().int().positive();

interface EvmChainId {
  readonly ref: ChainRef;
  readonly chainId: number;
}

// A CAIP-2 id in the eip155 namespace whose reference is an EIP-155 chain id.
function evmChainIdOf(id: string): EvmChainId | undefined {
  const ref = chainRefSchema.safeParse(id);
  if (!ref.success) {
    return undefined;
  }
  const { namespace, reference } = chainRefParts(ref.data);
  const chainId = chainIdSchema.safeParse(reference);
  return namespace === evmNamespace && chainIdPattern.test(reference) && chainId.success
    ? { ref: ref.data, chainId: chainId.data }
    : undefined;
}

function refuse(definition: ChainDefinition, problem: string): BinferenceError {
  return new BinferenceError({
    code: "chain.not_evm",
    message: `The chain ${definition.key} is not an EVM chain: ${problem}`,
    details: { chain: definition.key },
  });
}

/**
 * Reads the EVM view of a chain definition. A definition of another family, or one whose CAIP-2 id
 * is not `eip155` with an EIP-155 chain id, is a fault.
 */
export function evmChainOf(definition: ChainDefinition): EvmChain {
  if (definition.family !== evmFamilyId) {
    throw refuse(definition, `its family is ${definition.family}.`);
  }
  const id = evmChainIdOf(definition.id);
  if (id === undefined) {
    throw refuse(definition, `its id ${definition.id} is not eip155 with a chain id.`);
  }
  const { assetNamespace, assetReference, symbol, decimals } = definition.nativeAsset;
  return {
    ref: id.ref,
    chainId: id.chainId,
    name: definition.name,
    nativeAsset: assetRefSchema.parse(`${id.ref}/${assetNamespace}:${assetReference}`),
    nativeSymbol: symbol,
    nativeDecimals: decimals,
  };
}

/** The CAIP-10 id of an address on a chain. */
export function evmAccountRef(chain: EvmChain, address: Address): AccountRef {
  return accountRefSchema.parse(`${chain.ref}:${address}`);
}

/** The CAIP-19 asset type of an ERC-20 token on a chain. */
export function erc20AssetRef(chain: EvmChain, token: Address): AssetRef {
  return assetRefSchema.parse(`${chain.ref}/erc20:${token}`);
}
