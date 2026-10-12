import {
  type AccountRef,
  type AssetRef,
  assetRefSchema,
  type ChainRegistry,
  type RegisteredChain,
  type Signer,
} from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { IntentRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { WalletFactsSource } from "../ports.js";
import { type TradeAsk, tradeAskOf, tradeChainOf } from "./swap-trade.js";
import type { WalletFacts } from "./wallet-facts.js";

/** A proposal resolved against the agent's settings and wallet, before anything is stored. */
export interface ResolvedProposal {
  readonly settings: AgentSettings;
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  readonly chain: RegisteredChain;
  readonly nativeAsset: AssetRef;
  /** The trade asked for; its place and its amount are settled when its quote is built. */
  readonly ask: TradeAsk;
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
  /** The confirmed intent the request is resolved again for, left out of its own outflows. */
  readonly intent?: Id<"int">;
  /** The intent runs on paper; the agent's mode now when absent. A fill runs in its order's. */
  readonly isPaper?: boolean;
}

/** The native coin of a registered chain, as an asset. */
export function nativeAssetOf(chain: RegisteredChain): AssetRef {
  const { assetNamespace, assetReference } = chain.definition.nativeAsset;
  return assetRefSchema.parse(`${chain.ref}/${assetNamespace}:${assetReference}`);
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
 * chain, the trade asked for and the wallet's facts. A wallet that is not the agent's, or that the
 * custodian does not hold, is `wallet.not_found`; an asset with no canonical form on a chain the
 * registry holds, or a buy that spends neither the chain's coin nor a registry token, is
 * `protocol.bad_args`; a request the money path cannot route yet is `quote.no_route`. None stores
 * anything.
 */
export async function resolveProposal(
  options: ResolveOptions,
  resolving: Resolving,
): Promise<Result<ResolvedProposal, ProtocolErrorCode>> {
  const { request, settings, signal } = resolving;
  const chain = tradeChainOf(request, options.chains);
  if (chain === undefined) {
    return err("quote.no_route");
  }
  const wallet = await walletOf(options, resolving);
  const account =
    wallet === undefined ? undefined : await options.custody.account(wallet, chain.ref, { signal });
  if (wallet === undefined || account?.ok !== true) {
    return err("wallet.not_found");
  }
  const ask = tradeAskOf(request, { limits: settings.limits, chains: options.chains });
  if (!ask.ok) {
    return err(ask.error === "no_route" ? "quote.no_route" : ask.error);
  }
  const isPaper = resolving.isPaper ?? settings.agent.mode === "paper";
  const query = { agent: request.agent, wallet, account: account.value, isPaper };
  const { intent } = resolving;
  const facts = await options.wallets.facts(intent === undefined ? query : { ...query, intent }, {
    signal,
  });
  const nativeAsset = nativeAssetOf(chain);
  return ok({
    settings,
    wallet,
    account: account.value,
    chain,
    nativeAsset,
    ask: ask.value,
    facts,
  });
}
