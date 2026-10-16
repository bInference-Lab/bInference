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
import { launchWalletOf } from "../install/launch-wallet.js";
import type { WalletFactsSource } from "../ports.js";
import { type LaunchRouting, routedWalletOf } from "./launch-routing.js";
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
  /** The agent's live launch wallet, which alone runs a live trade on a launch's own curve. */
  readonly launchWallet?: Id<"wal">;
  /**
   * The curve read that picks the wallet failed, so the trade ends with this check reason once
   * the policy judged it (decision 0218); the agent's default wallet then holds the intent.
   */
  readonly launchUnread?: true;
}

/** What a proposal is resolved with. */
export interface ResolveOptions {
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly chains: ChainRegistry;
  /**
   * What sends a trade on a launch's own contracts to the agent's launch wallet (decision 0217);
   * without it, a request that names no wallet runs from the agent's oldest wallet.
   */
  readonly launches?: LaunchRouting;
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

/** What the launch routing found as it picked a request's wallet. */
type LaunchFacts = Pick<ResolvedProposal, "launchWallet" | "launchUnread">;

/** The wallet a request runs from, and what the launch routing found on the way. */
interface WalletPick {
  readonly wallet: Id<"wal">;
  readonly launch: LaunchFacts;
}

type Picking = Resolving & { readonly ask: TradeAsk; readonly chain: RegisteredChain };

async function launchIdOf(
  options: ResolveOptions,
  agent: Id<"agt">,
  signal: AbortSignal,
): Promise<Id<"wal"> | undefined> {
  const { launches } = options;
  return launches === undefined
    ? undefined
    : (await launchWalletOf(launches.install, agent, { signal }))?.id;
}

// A routing read that failed holds the intent on the default wallet, to end it (decision 0218).
async function routedPick(
  options: ResolveOptions,
  resolving: Picking,
  agentWallets: { readonly owned: readonly Id<"wal">[]; readonly launchWallet?: Id<"wal"> },
): Promise<WalletPick | undefined> {
  const { request, signal, ask, chain } = resolving;
  const { owned, launchWallet } = agentWallets;
  const isPaper = resolving.isPaper ?? resolving.settings.agent.mode === "paper";
  const trade = { agent: request.agent, chain, isPaper, owned };
  const placed = ask.placed === undefined ? {} : { placed: ask.placed };
  const sold = ask.kind === "buy" ? {} : { sold: ask.assetIn };
  const routed = await routedWalletOf(options.launches, { ...trade, ...placed, ...sold }, signal);
  const launch: LaunchFacts = launchWallet === undefined ? {} : { launchWallet };
  if (!routed.ok) {
    const fallback = owned.find((wallet) => wallet !== launchWallet);
    return fallback === undefined
      ? undefined
      : { wallet: fallback, launch: { ...launch, launchUnread: true } };
  }
  return routed.value === undefined ? undefined : { wallet: routed.value, launch };
}

// The request's wallet must be one of the agent's; without one, the trade routes to the agent's
// launch wallet or its default wallet (decision 0217).
async function walletOf(
  options: ResolveOptions,
  resolving: Picking,
): Promise<WalletPick | undefined> {
  const { request, signal } = resolving;
  const owned = await options.wallets.wallets(request.agent, { signal });
  const launchWallet = await launchIdOf(options, request.agent, signal);
  if (request.wallet === undefined) {
    const agentWallets = launchWallet === undefined ? { owned } : { owned, launchWallet };
    return routedPick(options, resolving, agentWallets);
  }
  const launch: LaunchFacts = launchWallet === undefined ? {} : { launchWallet };
  return owned.includes(request.wallet) ? { wallet: request.wallet, launch } : undefined;
}

/**
 * Resolves a request for the money path: the agent's wallet and its account on the trade's
 * chain, the trade asked for and the wallet's facts. A request that names no wallet runs from the
 * agent's launch wallet when its trade calls a launch's own contracts or sells what that wallet
 * holds, and from its default wallet otherwise (decision 0217); when the curve read that picks it
 * fails, from its default wallet, marked to end `launch_unread` (decision 0218). A wallet that is
 * not the agent's, or that the custodian does not hold, is `wallet.not_found`; an asset with no canonical form on a chain the
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
  const ask = tradeAskOf(request, { limits: settings.limits, chains: options.chains });
  if (!ask.ok) {
    return err(ask.error === "no_route" ? "quote.no_route" : ask.error);
  }
  const pick = await walletOf(options, { ...resolving, ask: ask.value, chain });
  const account =
    pick === undefined
      ? undefined
      : await options.custody.account(pick.wallet, chain.ref, { signal });
  if (pick === undefined || account?.ok !== true) {
    return err("wallet.not_found");
  }
  const { wallet } = pick;
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
    ...pick.launch,
  });
}
