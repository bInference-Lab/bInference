import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type Amount,
  assetRefParts,
  canonicalAsset,
  chainRefParts,
  type ChainRegistry,
  type RegisteredChain,
  recipientHex,
  type Signer,
} from "@binference/chain";
import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { BridgeRequest, ProtocolErrorCode } from "@binference/protocol";
import type { DestinationChain } from "../address-book/destination-chain.js";
import { isOwnWalletElsewhere } from "../address-book/saved-account.js";
import type { AgentSettings } from "../agents/agent-record.js";
import type { InstallFacts, WalletRecord } from "../install/install-record.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import { rescueAt } from "../policy/rescue-change.js";
import type { InstallStore, WalletFactsSource } from "../ports.js";
import { type BridgeCandidate, bridgeCandidatesOf } from "./bridge-routes.js";
import { type BridgeWallet, bridgeWalletOf } from "./bridge-wallet.js";
import type { HostedBridge } from "./hosted-bridge.js";

/** Who a bridge pays: an address book entry or the rescue address, on the destination chain. */
interface BridgePayee {
  readonly account: AccountRef;
  /** Its recipient bytes through the destination's codec, in lowercase hex. */
  readonly recipientBytes: string;
  /** The entry's label; absent for the rescue address. */
  readonly label?: string;
  /** The rescue address as the install holds it, on its own chain; absent for an entry. */
  readonly rescueHome?: AccountRef;
}

/** A bridge resolved against the agent's settings, wallets and routes, before it is stored. */
export interface ResolvedBridge {
  readonly settings: AgentSettings;
  readonly wallet: Id<"wal">;
  /** The wallet's account on the source chain, which pays and gets any refund. */
  readonly account: AccountRef;
  readonly chain: RegisteredChain;
  readonly amount: Amount;
  readonly destination: DestinationChain;
  readonly payee: BridgePayee;
  /** The routes the wallet may take, the agent's venues allowing each. */
  readonly candidates: readonly BridgeCandidate[];
  /** A venue of a route the agent's limits do not allow, when none is allowed. */
  readonly offVenue?: string;
  readonly facts: WalletFacts;
  readonly walletRecord?: WalletRecord;
}

/** What a bridge is resolved with. */
export interface BridgeResolveOptions {
  readonly chains: ChainRegistry;
  readonly destinations: readonly DestinationChain[];
  readonly bridges: readonly HostedBridge[];
  readonly custody: Pick<Signer, "account">;
  readonly wallets: WalletFactsSource;
  readonly install: Pick<InstallStore, "read">;
  readonly clock: Clock;
}

interface Resolving {
  readonly request: BridgeRequest;
  readonly settings: AgentSettings;
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

// An address on the destination through its codec: the account in its canonical form and its bytes.
function payeeOn(destination: DestinationChain, address: string): BridgePayee | undefined {
  const bytes = destination.codec.toBytes(address);
  const canonical = destination.codec.parse(address);
  const account = canonical.ok
    ? accountRefSchema.safeParse(`${destination.ref}:${canonical.value}`)
    : undefined;
  return bytes.ok && account?.success === true
    ? { account: account.data, recipientBytes: recipientHex(bytes.value) }
    : undefined;
}

/**
 * The rescue address in effect, on the destination: the same address through the destination's
 * codec, which reads it only in its own family (decision 0297); none is `rescue.no_address`, one
 * the destination cannot read `protocol.bad_args`. The plain-wallet check waits for the policy
 * (decision 0318).
 */
export function rescuePayee(
  options: BridgeResolveOptions,
  facts: InstallFacts,
  destination: DestinationChain,
): Result<BridgePayee, ProtocolErrorCode> {
  const { rescueAddress } = rescueAt(facts, options.clock.now());
  if (rescueAddress === undefined) {
    return err("rescue.no_address");
  }
  const { chain, address } = accountRefParts(rescueAddress);
  const sameFamily = chainRefParts(chain).namespace === destination.codec.namespace;
  const payee = sameFamily ? payeeOn(destination, address) : undefined;
  return payee === undefined
    ? err("protocol.bad_args")
    : ok({ ...payee, rescueHome: rescueAddress });
}

// The entry the request names, saved for the destination and never one of the install's wallets
// there, as a book restored from a backup may hold (decision 0318).
function entryPayee(
  resolving: Resolving & { readonly destination: DestinationChain; readonly facts: InstallFacts },
  entryId: Id<"adr">,
  chains: ChainRegistry,
): Result<BridgePayee, ProtocolErrorCode> {
  const { settings, destination, facts } = resolving;
  const entry = settings.addressBook.find((item) => item.id === entryId);
  if (entry === undefined) {
    return err("address.not_found");
  }
  if (accountRefParts(entry.account).chain !== destination.ref) {
    return err("protocol.bad_args");
  }
  const saved = {
    account: entry.account,
    recipientBytes: entry.recipientBytes,
    isWalletChain: false,
  };
  const wallets = facts.wallets.map((wallet) => wallet.address);
  return isOwnWalletElsewhere({ chains, destinations: [destination] }, saved, wallets)
    ? err("address.own_wallet")
    : ok({ account: entry.account, recipientBytes: entry.recipientBytes, label: entry.label });
}

// The wallet the bridge runs from, the routes it may take, its account on the source chain and its
// facts in the intent's mode.
async function walletOfBridge(
  options: BridgeResolveOptions,
  picking: Resolving & {
    readonly facts: InstallFacts;
    readonly candidates: readonly BridgeCandidate[];
    readonly chain: RegisteredChain;
  },
): Promise<
  Result<
    BridgeWallet & {
      readonly account: AccountRef;
      readonly walletFacts: WalletFacts;
      readonly walletRecord?: WalletRecord;
    },
    ProtocolErrorCode
  >
> {
  const { request, isPaper, signal, facts, candidates, chain } = picking;
  const owned = await options.wallets.wallets(request.agent, { signal });
  const named = request.wallet === undefined ? {} : { named: request.wallet };
  const picked = bridgeWalletOf({
    wallets: facts.wallets,
    owned,
    agent: request.agent,
    candidates,
    ...named,
  });
  if (!picked.ok) {
    return picked;
  }
  const { wallet } = picked.value;
  const account = await options.custody.account(wallet, chain.ref, { signal });
  if (!account.ok) {
    return err("wallet.not_found");
  }
  const query = { agent: request.agent, wallet, account: account.value, isPaper };
  const walletFacts = await options.wallets.facts(query, { signal });
  const walletRecord = facts.wallets.find((record) => record.id === wallet);
  return ok({
    ...picked.value,
    account: account.value,
    walletFacts,
    ...(walletRecord === undefined ? {} : { walletRecord }),
  });
}

// The asset sent, in its family's canonical form, on a chain the registry holds, and the
// destination the request names among the chains a bridge delivers to.
function placesOf(
  options: BridgeResolveOptions,
  request: BridgeRequest,
):
  | {
      readonly chain: RegisteredChain;
      readonly amount: Amount;
      readonly destination: DestinationChain;
    }
  | undefined {
  const asset = canonicalAsset(options.chains, request.amount.asset);
  const chain = asset.ok ? options.chains.get(assetRefParts(asset.value).chain) : undefined;
  const destination = options.destinations.find((item) => item.ref === request.toChain);
  return asset.ok && chain?.ok === true && destination !== undefined
    ? { chain: chain.value, amount: { asset: asset.value, base: request.amount.base }, destination }
    : undefined;
}

/**
 * Resolves a bridge for its path (decisions 0297 and 0319): the asset it sends on a chain the
 * registry holds, the destination among the chains a bridge delivers to, who it pays, the routes
 * the hosted bridges serve and the wallet they run from, its account and its facts. An asset or a
 * destination outside them, an entry of another chain, or the rescue address on a chain of
 * another family is `protocol.bad_args`; an unknown entry `address.not_found`, an entry that is one
 * of the install's wallets `address.own_wallet`, no rescue address `rescue.no_address`, and the
 * wallet's refusals are `bridgeWalletOf`'s. None stores anything.
 */
export async function resolveBridge(
  options: BridgeResolveOptions,
  resolving: Resolving,
): Promise<Result<ResolvedBridge, ProtocolErrorCode>> {
  const { request, settings, signal } = resolving;
  const places = placesOf(options, request);
  if (places === undefined) {
    return err("protocol.bad_args");
  }
  const { chain, amount, destination } = places;
  const facts = await options.install.read({ signal });
  const payee =
    "rescue" in request.to
      ? rescuePayee(options, facts, destination)
      : entryPayee({ ...resolving, destination, facts }, request.to.entry, options.chains);
  if (!payee.ok) {
    return payee;
  }
  const routes = bridgeCandidatesOf(options.bridges, {
    sent: amount.asset,
    toChain: destination.ref,
    venues: settings.limits.venues,
  });
  const picked = await walletOfBridge(options, {
    ...resolving,
    facts,
    candidates: routes.allowed,
    chain,
  });
  if (!picked.ok) {
    return picked;
  }
  const { wallet, candidates, account, walletFacts, walletRecord } = picked.value;
  return ok({
    settings,
    wallet,
    account,
    chain,
    amount,
    destination,
    payee: payee.value,
    candidates,
    ...(routes.offVenue === undefined ? {} : { offVenue: routes.offVenue }),
    facts: walletFacts,
    ...(walletRecord === undefined ? {} : { walletRecord }),
  });
}
