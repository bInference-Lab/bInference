import {
  type AccountRef,
  accountRefParts,
  type AssetRef,
  assetRefParts,
  type BridgeQuoteRequest,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import { isAddress } from "@solana/kit";
import type { Address } from "viem";
import type { QuoteBody } from "../api/relay-api.js";
import { type RelayChain, relayChainOf } from "../relay-chains.js";
import type { RelayOptions, RelayRoute } from "../relay-options.js";

/** How long Relay is asked to keep a quote's order fillable, in seconds (decision 0322). */
export const quoteTtlSeconds = 3_600;

/**
 * What the bridge asks Relay for one request, each part as Relay writes it: the route, both
 * chains, the wallet that deposits, the token and amount that leave, who is paid on the
 * destination and in which token.
 */
export interface RelayAsk {
  readonly route: RelayRoute;
  readonly origin: RelayChain;
  readonly destination: RelayChain;
  readonly depositor: Address;
  readonly tokenIn: Address;
  readonly amount: bigint;
  /** The recipient: a checksummed address on an EVM chain, base58 on Solana. */
  readonly recipient: string;
  /** The token that arrives: a checksummed address on an EVM chain, a mint on Solana. */
  readonly currencyOut: string;
}

// An account of a chain Relay names, as Relay writes it there; none for another chain's account.
function accountOn(chain: RelayChain, account: AccountRef): string | undefined {
  const parts = accountRefParts(account);
  if (parts.chain !== chain.chain) {
    return undefined;
  }
  if (chain.vm === "svm") {
    return isAddress(parts.address) ? parts.address : undefined;
  }
  const parsed = parseEvmAddress(parts.address);
  return parsed.ok ? parsed.value : undefined;
}

// A token of a chain Relay names, as Relay writes it: an ERC-20 on an EVM chain, an SPL mint on
// Solana; none for a coin or another kind.
function tokenOn(asset: AssetRef): { chain: RelayChain; currency: string } | undefined {
  const { chain: chainRef, assetNamespace, assetReference } = assetRefParts(asset);
  const chain = relayChainOf(chainRef);
  if (chain?.vm === "evm" && assetNamespace === "erc20") {
    const parsed = parseEvmAddress(assetReference);
    return parsed.ok ? { chain, currency: parsed.value } : undefined;
  }
  const isMint = chain?.vm === "svm" && assetNamespace === "token" && isAddress(assetReference);
  return isMint ? { chain, currency: assetReference } : undefined;
}

// The route the registry lists for Relay from a chain the bridge declares, for a token that leaves
// with a 24-hour cap in the wallet's ceiling (decision 0305). The wallet's own chain is checked
// where its address is read.
function listedRoute(request: BridgeQuoteRequest, options: RelayOptions): RelayRoute | undefined {
  return options.routes.find(
    ({ leaves, arrives }) =>
      leaves === request.amountIn.asset &&
      arrives === request.deliveredAsset &&
      request.cappedAssets.includes(leaves) &&
      options.chains.includes(assetRefParts(leaves).chain),
  );
}

/**
 * What the bridge asks Relay for a request, or `undefined` when it does not take it: a route the
 * registry does not list for Relay, a token that leaves without a 24-hour cap, a wallet or a token
 * on another chain, or a recipient that is no account of the destination chain.
 */
export function relayAskOf(
  request: BridgeQuoteRequest,
  options: RelayOptions,
): RelayAsk | undefined {
  const route = listedRoute(request, options);
  const leaves = tokenOn(request.amountIn.asset);
  const arrives = tokenOn(request.deliveredAsset);
  if (route === undefined || leaves?.chain.vm !== "evm" || arrives === undefined) {
    return undefined;
  }
  const depositor = parseEvmAddress(accountOn(leaves.chain, request.wallet) ?? "");
  const recipient = accountOn(arrives.chain, request.recipient);
  const tokenIn = parseEvmAddress(leaves.currency);
  if (!depositor.ok || recipient === undefined || !tokenIn.ok) {
    return undefined;
  }
  return {
    route,
    origin: leaves.chain,
    destination: arrives.chain,
    depositor: depositor.value,
    tokenIn: tokenIn.value,
    amount: request.amountIn.base,
    recipient,
    currencyOut: arrives.currency,
  };
}

/** The quote request for what the bridge asks: no slippage, refunds to the wallet on its chain. */
export function quoteBodyOf(ask: RelayAsk): QuoteBody {
  return {
    user: ask.depositor,
    recipient: ask.recipient,
    originChainId: Number(ask.origin.id),
    destinationChainId: Number(ask.destination.id),
    originCurrency: ask.tokenIn,
    destinationCurrency: ask.currencyOut,
    amount: ask.amount.toString(),
    tradeType: "EXACT_INPUT",
    refundTo: ask.depositor,
    refundOnOrigin: true,
    includeProtocolData: true,
    slippageTolerance: "0",
    ttl: quoteTtlSeconds,
  };
}
