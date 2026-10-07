import {
  type AccountRef,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  type ChainRegistry,
  type RegisteredChain,
  type Signer,
} from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { IntentRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { WalletFactsSource } from "../ports.js";
import { type SwapTrade, swapTradeOf } from "./swap-trade.js";
import type { WalletFacts } from "./wallet-facts.js";

/** A proposal resolved against the agent's settings and wallet, before anything is stored. */
export interface ResolvedProposal {
  readonly settings: AgentSettings;
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  readonly chain: RegisteredChain;
  readonly nativeAsset: AssetRef;
  readonly swap: SwapTrade;
  readonly facts: WalletFacts;
}

/** What a proposal is resolved with. */
export interface ResolveOptions {
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly chains: ChainRegistry;
}

interface Resolving {
  readonly request: IntentRequest;
  readonly settings: AgentSettings;
  readonly signal: AbortSignal;
}

/** The native coin of a registered chain, as an asset. */
export function nativeAssetOf(chain: RegisteredChain): AssetRef {
  const { assetNamespace, assetReference } = chain.definition.nativeAsset;
  return assetRefSchema.parse(`${chain.ref}/${assetNamespace}:${assetReference}`);
}

/**
 * The chain a request trades on: the one of the asset a swap sells. The money path routes swaps
 * only, so any other kind, or a chain the registry does not hold, is `undefined`.
 */
export function swapChainOf(
  request: IntentRequest,
  chains: ChainRegistry,
): RegisteredChain | undefined {
  if (request.kind !== "swap") {
    return undefined;
  }
  const chain = chains.get(assetRefParts(request.from).chain);
  return chain.ok ? chain.value : undefined;
}

// The request's wallet must be one of the agent's; without one, the agent's default acts.
async function walletOf(
  options: ResolveOptions,
  resolving: Resolving,
): Promise<Id<"wal"> | undefined> {
  const { request, signal } = resolving;
  const owned = await options.wallets.wallets(request.agent, { signal });
  const wallet = request.wallet ?? owned[0];
  return wallet !== undefined && owned.includes(wallet) ? wallet : undefined;
}

/**
 * Resolves a request for the money path: the agent's wallet and its account on the trade's
 * chain, the trade itself and the wallet's facts. A wallet that is not the agent's, or that the
 * custodian does not hold, is `wallet.not_found`; a request the money path cannot route yet is
 * `quote.no_route`. Neither stores anything.
 */
export async function resolveProposal(
  options: ResolveOptions,
  resolving: Resolving,
): Promise<Result<ResolvedProposal, ProtocolErrorCode>> {
  const { request, settings, signal } = resolving;
  const chain = swapChainOf(request, options.chains);
  if (chain === undefined) {
    return err("quote.no_route");
  }
  const wallet = await walletOf(options, resolving);
  const account =
    wallet === undefined ? undefined : await options.custody.account(wallet, chain.ref, { signal });
  if (wallet === undefined || account?.ok !== true) {
    return err("wallet.not_found");
  }
  const context = { limits: settings.limits, account: account.value, chains: options.chains };
  const swap = swapTradeOf(request, context);
  if (!swap.ok) {
    return err("quote.no_route");
  }
  const isPaper = settings.agent.mode === "paper";
  const query = { agent: request.agent, wallet, account: account.value, isPaper };
  const facts = await options.wallets.facts(query, { signal });
  const nativeAsset = nativeAssetOf(chain);
  return ok({
    settings,
    wallet,
    account: account.value,
    chain,
    nativeAsset,
    swap: swap.value,
    facts,
  });
}
