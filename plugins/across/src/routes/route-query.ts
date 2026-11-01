import {
  type AccountRef,
  accountRefParts,
  type AssetRef,
  assetRefParts,
  type BridgeQuoteRequest,
} from "@binference/plugin-sdk";
import { eip155ChainIdOf, parseEvmAddress } from "@binference/plugin-sdk/evm";
import { type Address, zeroAddress } from "viem";
import type { AcrossOptions, AcrossRoute } from "../across-options.js";
import type { SwapQuery } from "../api/across-api.js";

// An ERC-20 token of an EIP-155 chain, with that chain's id.
function tokenOf(asset: AssetRef): { chainId: bigint; address: Address } | undefined {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const chainId = eip155ChainIdOf(chain);
  const address = parseEvmAddress(assetReference);
  return assetNamespace === "erc20" && chainId !== undefined && address.ok
    ? { chainId: BigInt(chainId), address: address.value }
    : undefined;
}

function addressOf(account: AccountRef, chainId: bigint): Address | undefined {
  const { chain, address } = accountRefParts(account);
  const parsed = parseEvmAddress(address);
  const id = eip155ChainIdOf(chain);
  return id !== undefined && BigInt(id) === chainId && parsed.ok ? parsed.value : undefined;
}

// The route the registry lists for Across, when its token that leaves has a 24-hour cap in the
// wallet's ceiling (decision 0305) and the wallet is on a chain the bridge declares.
function listedRoute(request: BridgeQuoteRequest, options: AcrossOptions): AcrossRoute | undefined {
  const { amountIn, deliveredAsset, cappedAssets, wallet } = request;
  const isOpen =
    options.chains.includes(accountRefParts(wallet).chain) && cappedAssets.includes(amountIn.asset);
  return isOpen
    ? options.routes.find(
        (route) => route.leaves === amountIn.asset && route.arrives === deliveredAsset,
      )
    : undefined;
}

/** A Swap API query and the registry's route it asks. */
export interface RoutedQuery {
  readonly query: SwapQuery;
  readonly route: AcrossRoute;
}

/**
 * The Swap API query for a bridge request and its route, or `undefined` when the bridge does not
 * take it: a route
 * the registry does not list for Across, a token that leaves without a 24-hour cap, a wallet or a
 * token on another chain, or a recipient that is no address of the destination chain. A recipient
 * on Solana is one: Across serves no route there from BNB Smart Chain (2026-11-01).
 */
export function routeQueryOf(
  request: BridgeQuoteRequest,
  options: AcrossOptions,
): RoutedQuery | undefined {
  const route = listedRoute(request, options);
  const tokenIn = tokenOf(request.amountIn.asset);
  const tokenOut = tokenOf(request.deliveredAsset);
  if (route === undefined || tokenIn === undefined || tokenOut === undefined) {
    return undefined;
  }
  const depositor = addressOf(request.wallet, tokenIn.chainId);
  const recipient = addressOf(request.recipient, tokenOut.chainId);
  if (depositor === undefined || recipient === undefined) {
    return undefined;
  }
  const query = {
    originChainId: tokenIn.chainId,
    destinationChainId: tokenOut.chainId,
    inputToken: tokenIn.address,
    outputToken: tokenOut.address,
    askedOutput: route.coin === undefined ? tokenOut.address : zeroAddress,
    amount: request.amountIn.base,
    depositor,
    recipient,
  };
  return { query, route };
}
