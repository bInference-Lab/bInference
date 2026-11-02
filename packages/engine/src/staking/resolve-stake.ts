import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type AssetRef,
  canonicalAsset,
  type ChainRegistry,
  type RegisteredChain,
  type Signer,
} from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, StakeRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { WalletRecord } from "../install/install-record.js";
import { defaultWalletIn, namedWalletRefusal } from "../install/role-wallet.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import { canonicalAccount } from "../operations/canonical-account.js";
import type { InstallStore, WalletFactsSource } from "../ports.js";
import type { StakingHost } from "../venues/staking-host.js";

/**
 * What a staking request asks, read for its validator's chain: a stake of exactly `amount` of the
 * chain's coin, an unstake of at least `amount` of it or of the whole stake, or a claim.
 */
type StakeAsk = { readonly validator: AccountRef } & (
  | { readonly action: "stake"; readonly amount: Amount }
  | { readonly action: "unstake"; readonly amount: Amount | "whole" }
  | { readonly action: "claim" }
);

/** A staking request resolved against the agent's settings and wallet, before it is stored. */
export interface ResolvedStake {
  readonly settings: AgentSettings;
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  readonly chain: RegisteredChain;
  readonly nativeAsset: AssetRef;
  readonly venue: StakingVenue;
  readonly ask: StakeAsk;
  readonly facts: WalletFacts;
  /** The wallet as the install holds it, with its ceiling; absent when the install lists none. */
  readonly walletRecord?: WalletRecord;
}

/** What a staking request is resolved with. */
export interface StakeResolveOptions {
  readonly chains: ChainRegistry;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly install: Pick<InstallStore, "read">;
  readonly staking: StakingHost;
}

interface Resolving {
  readonly request: StakeRequest;
  readonly settings: AgentSettings;
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

interface AskContext {
  readonly chains: ChainRegistry;
  readonly validator: AccountRef;
  readonly coin: AssetRef;
}

// The amount the request names, in its family's canonical form, when it is more than nothing of
// the chain's coin.
function coinAmountOf(request: StakeRequest, context: AskContext): Amount | undefined {
  const { amount } = request;
  const asset = amount === undefined ? undefined : canonicalAsset(context.chains, amount.asset);
  return amount !== undefined &&
    asset?.ok === true &&
    asset.value === context.coin &&
    amount.base > 0n
    ? { asset: context.coin, base: amount.base }
    : undefined;
}

// What the request asks of the chain's coin; an unstake that names no amount takes the whole
// stake, and a claim names none.
function askOf(request: StakeRequest, context: AskContext): StakeAsk | undefined {
  const { validator } = context;
  const amount = coinAmountOf(request, context);
  if (request.action === "claim") {
    return request.amount === undefined ? { action: "claim", validator } : undefined;
  }
  if (request.action === "unstake" && request.amount === undefined) {
    return { action: "unstake", validator, amount: "whole" };
  }
  return amount === undefined ? undefined : { action: request.action, validator, amount };
}

// The request's wallet must be one of the agent's, and neither its bridge wallet nor an extra one
// of a role (decision 0307); without one, the move runs from the agent's default wallet.
async function walletOf(
  options: StakeResolveOptions,
  request: StakeRequest,
  call: { readonly wallets: readonly WalletRecord[]; readonly signal: AbortSignal },
): Promise<Result<Id<"wal">, ProtocolErrorCode>> {
  const owned = await options.wallets.wallets(request.agent, { signal: call.signal });
  const named = request.wallet;
  const refusal =
    named === undefined
      ? undefined
      : namedWalletRefusal(call.wallets, { agent: request.agent, wallet: named });
  const wallet = named ?? defaultWalletIn(call.wallets, owned);
  if (refusal !== undefined) {
    return err(refusal);
  }
  return wallet !== undefined && owned.includes(wallet) ? ok(wallet) : err("wallet.not_found");
}

interface StakePlace {
  readonly validator: AccountRef;
  readonly chain: RegisteredChain;
  readonly venue: StakingVenue;
}

// The validator in its family's canonical form, its chain, and the venue the engine runs there under
// the request's venue id; none when any is missing.
function placeOf(options: StakeResolveOptions, request: StakeRequest): StakePlace | undefined {
  if (request.validator === undefined) {
    return undefined;
  }
  const validator = canonicalAccount(options.chains, request.validator);
  const chain = validator.ok
    ? options.chains.get(accountRefParts(validator.value).chain)
    : undefined;
  if (!validator.ok || chain?.ok !== true) {
    return undefined;
  }
  const venue = options.staking.venueOn(request.venue, chain.value.ref);
  return venue === undefined
    ? undefined
    : { validator: validator.value, chain: chain.value, venue };
}

/**
 * Resolves a staking request for its path (decision 0327): the validator's chain and the staking
 * venue the engine runs there under the request's venue id, what it asks, the agent's wallet and
 * its account there, and the wallet's facts in the intent's mode. A request that names no
 * validator, a venue the engine does not run on that chain, an amount of another asset than the
 * chain's coin, none on a stake, or one on a claim, is `protocol.bad_args`. None stores anything.
 */
export async function resolveStake(
  options: StakeResolveOptions,
  resolving: Resolving,
): Promise<Result<ResolvedStake, ProtocolErrorCode>> {
  const { request, settings, isPaper, signal } = resolving;
  const place = placeOf(options, request);
  const nativeAsset = place === undefined ? undefined : nativeAssetOf(place.chain);
  const ask =
    place === undefined || nativeAsset === undefined
      ? undefined
      : askOf(request, { chains: options.chains, validator: place.validator, coin: nativeAsset });
  if (place === undefined || nativeAsset === undefined || ask === undefined) {
    return err("protocol.bad_args");
  }
  const { chain, venue } = place;
  const install = await options.install.read({ signal });
  const wallet = await walletOf(options, request, { wallets: install.wallets, signal });
  if (!wallet.ok) {
    return wallet;
  }
  const account = await options.custody.account(wallet.value, chain.ref, { signal });
  if (!account.ok) {
    return err("wallet.not_found");
  }
  const query = { agent: request.agent, wallet: wallet.value, account: account.value, isPaper };
  const facts = await options.wallets.facts(query, { signal });
  const walletRecord = install.wallets.find((record) => record.id === wallet.value);
  return ok({
    settings,
    wallet: wallet.value,
    account: account.value,
    chain,
    nativeAsset,
    venue,
    ask,
    facts,
    ...(walletRecord === undefined ? {} : { walletRecord }),
  });
}
