import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  assetRefParts,
  canonicalAsset,
  type RegisteredChain,
  type Signer,
} from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, RevokeApprovalRequest, SendRequest } from "@binference/protocol";
import { payeeRefusal } from "../address-book/payee-refusal.js";
import type { AgentSettings } from "../agents/agent-record.js";
import type { WalletRecord } from "../install/install-record.js";
import { defaultWalletIn, namedWalletRefusal } from "../install/role-wallet.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import { canonicalAccount } from "../operations/canonical-account.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { InstallStore, WalletFactsSource } from "../ports.js";
import { type ResolvedTarget, resolveTarget, type TargetParts } from "./resolve-target.js";

/** A send or an approval revoke, the two requests that pay or free an account (spec 6). */
export type TransferRequest = SendRequest | RevokeApprovalRequest;

/** What a send or a revoke asks, read for its wallet's chain. */
export type TransferAsk =
  | { readonly kind: "send"; readonly amount: Amount; readonly target: ResolvedTarget }
  | { readonly kind: "revokeApproval"; readonly token: AssetRef; readonly spender: AccountRef };

/** A send or a revoke resolved against the agent's settings and wallet, before it is stored. */
export interface ResolvedTransfer {
  readonly settings: AgentSettings;
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  readonly chain: RegisteredChain;
  readonly nativeAsset: AssetRef;
  readonly ask: TransferAsk;
  readonly facts: WalletFacts;
  /** The install's rescue address in effect now, which a send may pay; absent when none is set. */
  readonly rescueAccount?: AccountRef;
}

/** What a send or a revoke is resolved with. */
export interface TransferResolveOptions extends TargetParts {
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly install: Pick<InstallStore, "read">;
}

interface Resolving {
  readonly request: TransferRequest;
  readonly settings: AgentSettings;
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

// The asset that names the chain: what a send moves, or the token a revoke frees.
function movedAsset(request: TransferRequest): AssetRef {
  return request.kind === "send" ? request.amount.asset : request.token;
}

// The request's wallet must be one of the agent's, and neither its bridge wallet nor an extra
// one of a role (decision 0307); without one, the send runs from the agent's default wallet.
async function walletOf(
  options: TransferResolveOptions,
  request: TransferRequest,
  call: { readonly wallets: readonly WalletRecord[]; readonly signal: AbortSignal },
): Promise<Result<Id<"wal">, ProtocolErrorCode>> {
  const { wallets, signal } = call;
  const owned = await options.wallets.wallets(request.agent, { signal });
  if (request.wallet === undefined) {
    const fallback = defaultWalletIn(wallets, owned);
    return fallback === undefined ? err("wallet.not_found") : ok(fallback);
  }
  const refusal = namedWalletRefusal(wallets, { agent: request.agent, wallet: request.wallet });
  if (refusal !== undefined) {
    return err(refusal);
  }
  return owned.includes(request.wallet) ? ok(request.wallet) : err("wallet.not_found");
}

// What the request asks on the wallet's chain: a send's target, or a revoke's spender on it.
async function askOf(
  options: TransferResolveOptions,
  resolving: Resolving & { readonly chain: RegisteredChain; readonly asset: AssetRef },
): Promise<Result<TransferAsk, ProtocolErrorCode>> {
  const { request, chain, asset } = resolving;
  if (request.kind === "revokeApproval") {
    // The chain's coin has no allowance to revoke.
    const spender = canonicalAccount(options.chains, request.spender);
    const isToken = asset !== nativeAssetOf(chain);
    return isToken && spender.ok && accountRefParts(spender.value).chain === chain.ref
      ? ok({ kind: "revokeApproval", token: asset, spender: spender.value })
      : err("protocol.bad_args");
  }
  const target = await resolveTarget(options, request.to, { ...resolving, chain });
  if (!target.ok) {
    return target;
  }
  const amount = { asset, base: request.amount.base };
  return ok({ kind: "send", amount, target: target.value });
}

// No send pays a launch or a bridge wallet of the install, which the owner funds from outside
// (decisions 0218 and 0307), nor a venue's contract (decision 0307).
function targetRefusal(
  options: TransferResolveOptions,
  ask: TransferAsk,
  wallets: readonly WalletRecord[],
): ProtocolErrorCode | undefined {
  return ask.kind === "send" && ask.target.kind === "account"
    ? payeeRefusal(wallets, ask.target.account, options.chains)
    : undefined;
}

// The chain of the asset the request moves, with that asset in its family's canonical form.
function chainOf(
  options: TransferResolveOptions,
  request: TransferRequest,
): { readonly chain: RegisteredChain; readonly asset: AssetRef } | undefined {
  const asset = canonicalAsset(options.chains, movedAsset(request));
  const chain = asset.ok ? options.chains.get(assetRefParts(asset.value).chain) : undefined;
  return asset.ok && chain?.ok === true ? { chain: chain.value, asset: asset.value } : undefined;
}

// The wallet the request runs from and its account on the chain.
async function walletAndAccount(
  options: TransferResolveOptions,
  resolving: Resolving & { readonly chain: RegisteredChain },
  wallets: readonly WalletRecord[],
): Promise<
  Result<{ readonly wallet: Id<"wal">; readonly account: AccountRef }, ProtocolErrorCode>
> {
  const { request, chain, signal } = resolving;
  const wallet = await walletOf(options, request, { wallets, signal });
  if (!wallet.ok) {
    return wallet;
  }
  const account = await options.custody.account(wallet.value, chain.ref, { signal });
  return account.ok
    ? ok({ wallet: wallet.value, account: account.value })
    : err("wallet.not_found");
}

/**
 * Resolves a send or an approval revoke for its path: the chain of the asset it moves, the
 * agent's wallet and its account there, what it asks (a send's target, or a revoke's spender),
 * the wallet's facts in the intent's mode and the rescue address in effect. A request that names
 * no wallet runs from the agent's default wallet. An asset with no canonical form on a chain the
 * registry holds, a revoke of the chain's coin, or a spender or target on another chain, is
 * `protocol.bad_args`; a send to a
 * launch or a bridge wallet of the install is `address.launch_wallet` or `address.bridge_wallet`,
 * and one to a venue's contract `address.venue_contract`.
 * The target's own refusals are `resolveTarget`'s. None stores anything.
 */
export async function resolveTransfer(
  options: TransferResolveOptions,
  resolving: Resolving,
): Promise<Result<ResolvedTransfer, ProtocolErrorCode>> {
  const { request, settings, isPaper, signal } = resolving;
  const on = chainOf(options, request);
  if (on === undefined) {
    return err("protocol.bad_args");
  }
  const install = await options.install.read({ signal });
  const picked = await walletAndAccount(
    options,
    { ...resolving, chain: on.chain },
    install.wallets,
  );
  if (!picked.ok) {
    return picked;
  }
  const ask = await askOf(options, { ...resolving, ...on });
  const refusal = ask.ok ? targetRefusal(options, ask.value, install.wallets) : undefined;
  if (!ask.ok || refusal !== undefined) {
    return ask.ok ? err(refusal ?? "protocol.bad_args") : ask;
  }
  const { wallet, account } = picked.value;
  const facts = await options.wallets.facts(
    { agent: request.agent, wallet, account, isPaper },
    { signal },
  );
  const { rescueAddress } = rescueAt(install, options.clock.now());
  return ok({
    settings,
    wallet,
    account,
    chain: on.chain,
    nativeAsset: nativeAssetOf(on.chain),
    ask: ask.value,
    facts,
    ...(rescueAddress === undefined ? {} : { rescueAccount: rescueAddress }),
  });
}
