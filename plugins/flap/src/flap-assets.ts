import {
  type AccountRef,
  accountRefParts,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  BinferenceError,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { type Address, zeroAddress } from "viem";
import type { ChainSetup } from "./chain-setup.js";

/** Flap's Portal: it quotes, and trades every token on a Flap curve. */
export const portalName = "portal";

/**
 * The address Flap's Portal writes for an asset on the chain: the zero address for the chain's
 * coin, or the ERC-20 token's address in checksum form. Undefined for an asset of another chain or
 * another kind.
 */
export function flapTokenOf(asset: AssetRef, on: ChainSetup): Address | undefined {
  if (asset === on.nativeAsset) {
    return zeroAddress;
  }
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const token = parseEvmAddress(assetReference);
  const isToken = chain === on.chain && assetNamespace === "erc20" && token.ok;
  return isToken && token.value !== zeroAddress ? token.value : undefined;
}

/** The asset an address of Flap's Portal names on the chain. */
export function assetOfFlapToken(token: Address, on: ChainSetup): AssetRef {
  return token === zeroAddress
    ? on.nativeAsset
    : assetRefSchema.parse(`${on.chain}/erc20:${token}`);
}

// The address of an EVM account, in checksum form.
function addressOf(account: AccountRef): Address {
  const address = parseEvmAddress(accountRefParts(account).address);
  if (!address.ok) {
    throw new BinferenceError({
      code: "flap.not_evm",
      message: "Flap trades only from and with EVM accounts.",
    });
  }
  return address.value;
}

/** The Portal among the contracts the host gave with a request, as an EVM address. */
export function portalOf(contracts: Readonly<Record<string, AccountRef>>): Address {
  const portal = contracts[portalName];
  if (portal === undefined) {
    throw new BinferenceError({
      code: "flap.no_contract",
      message: "The request carries no Portal; the venue declares it on every chain.",
      details: { name: portalName },
    });
  }
  return addressOf(portal);
}
