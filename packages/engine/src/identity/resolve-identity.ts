import type { AccountRef, ChainRegistry, RegisteredChain, Signer } from "@binference/chain";
import type {
  IdentityRegistry,
  IdentityStanding,
  RegistrationCard,
} from "@binference/chain/identity";
import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, RegisterIdentityRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { WalletRecord } from "../install/install-record.js";
import { defaultWalletIn } from "../install/role-wallet.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { InstallStore, WalletFactsSource } from "../ports.js";
import type { IdentityHost } from "./identity-host.js";
import { hasRegistrationIn, openRegistrationStates } from "./open-registrations.js";
import type { IdentityStore } from "./ports.js";
import { hasHiddenText } from "./published-text.js";

/** What an identity registration is resolved with. */
export interface IdentityResolveOptions {
  readonly identity: IdentityHost;
  readonly identities: IdentityStore;
  /** The stored intents, among which an open registration of the agent waits. */
  readonly stored: Pick<StoredIntents, "list">;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly install: Pick<InstallStore, "read">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  /** binference's release version, which the registration file publishes (decision 0334). */
  readonly version: string;
}

/** A registration resolved against the agent's settings and main wallet, before it is stored. */
export interface ResolvedIdentity {
  readonly settings: AgentSettings;
  readonly registry: IdentityRegistry;
  readonly chain: RegisteredChain;
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  readonly facts: WalletFacts;
  /** The card's fields, which the registration file publishes. */
  readonly card: RegistrationCard;
  /** The registry's version and the wallet's identities, read for a live registration only. */
  readonly standing?: IdentityStanding;
  readonly walletRecord?: WalletRecord;
}

interface Resolving {
  readonly request: RegisterIdentityRequest;
  readonly settings: AgentSettings;
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

// The agent's main wallet on the registry's chain, the one that registers and holds the identity.
async function mainWallet(
  options: IdentityResolveOptions,
  resolving: Resolving & { readonly chain: RegisteredChain },
): Promise<
  Result<
    {
      readonly wallet: Id<"wal">;
      readonly account: AccountRef;
      readonly walletRecord?: WalletRecord;
    },
    ProtocolErrorCode
  >
> {
  const { request, chain, signal } = resolving;
  const install = await options.install.read({ signal });
  const owned = await options.wallets.wallets(request.agent, { signal });
  const wallet = defaultWalletIn(install.wallets, owned);
  const account =
    wallet === undefined ? undefined : await options.custody.account(wallet, chain.ref, { signal });
  if (wallet === undefined || account?.ok !== true) {
    return err("wallet.not_found");
  }
  const walletRecord = install.wallets.find((record) => record.id === wallet);
  return ok({
    wallet,
    account: account.value,
    ...(walletRecord === undefined ? {} : { walletRecord }),
  });
}

// A live registration reads the registry first: a wallet that holds an identity already, made
// before a rebuild or outside binference, is refused before anything is stored (decision 0335).
async function standingOf(
  options: IdentityResolveOptions,
  check: {
    readonly registry: IdentityRegistry;
    readonly account: AccountRef;
    readonly signal: AbortSignal;
  },
): Promise<Result<IdentityStanding, ProtocolErrorCode>> {
  const read = await options.identity.standing(check.registry, check.account, check);
  if (!read.ok) {
    return err("quote.venue_down");
  }
  return read.value.held > 0n ? err("intent.identity_exists") : ok(read.value);
}

// Why the registration cannot be made, from the engine's own records alone: text a reader would not
// see as written, an identity binference holds, or another registration that has not ended.
async function refusalBeforeReads(
  options: IdentityResolveOptions,
  resolving: Resolving,
): Promise<ProtocolErrorCode | undefined> {
  const { request, settings, signal } = resolving;
  if (hasHiddenText(settings.agent.name) || hasHiddenText(request.description ?? "")) {
    return "intent.identity_text";
  }
  if ((await options.identities.get(request.agent, { signal })) !== undefined) {
    return "intent.identity_exists";
  }
  const open = { agent: request.agent, states: openRegistrationStates };
  return (await hasRegistrationIn(options.stored, open, signal))
    ? "intent.identity_pending"
    : undefined;
}

/**
 * Resolves an identity registration (decision 0335): the registry the engine runs, the agent's
 * main wallet and its account on the registry's chain, the card's fields (the agent's name, the
 * owner's description, that wallet and binference's version) and the wallet's facts in the
 * intent's mode. No registry is `intent.kind_unavailable`; an agent whose identity binference
 * holds, or a live one whose wallet the registry finds holding one, is `intent.identity_exists`;
 * one with a registration that has not ended, `intent.identity_pending`; a name or description
 * holding a character a reader would not see as written, `intent.identity_text`;
 * a registry that cannot be read `quote.venue_down`; an agent with no main wallet there
 * `wallet.not_found`. None stores anything.
 */
export async function resolveIdentity(
  options: IdentityResolveOptions,
  resolving: Resolving,
): Promise<Result<ResolvedIdentity, ProtocolErrorCode>> {
  const { request, settings, isPaper, signal } = resolving;
  const served = servedRegistry(options);
  if (served === undefined) {
    return err("intent.kind_unavailable");
  }
  const refusal = await refusalBeforeReads(options, resolving);
  if (refusal !== undefined) {
    return err(refusal);
  }
  const { registry, chain } = served;
  const main = await mainWallet(options, { ...resolving, chain });
  if (!main.ok) {
    return main;
  }
  const { wallet, account } = main.value;
  const standing = isPaper ? undefined : await standingOf(options, { registry, account, signal });
  if (standing?.ok === false) {
    return standing;
  }
  const facts = await options.wallets.facts(
    { agent: request.agent, wallet, account, isPaper },
    { signal },
  );
  const description = request.description ?? "";
  const card = {
    name: settings.agent.name,
    description,
    wallet: account,
    version: options.version,
  };
  const read = standing === undefined ? {} : { standing: standing.value };
  return ok({ settings, registry, chain, ...main.value, facts, card, ...read });
}

// The registry a registration uses, the first the engine runs, on a chain the registry lists.
function servedRegistry(
  options: IdentityResolveOptions,
): { readonly registry: IdentityRegistry; readonly chain: RegisteredChain } | undefined {
  const registry = options.identity.registries[0];
  const chain = registry === undefined ? undefined : options.chains.get(registry.chain);
  return registry === undefined || chain?.ok !== true
    ? undefined
    : { registry, chain: chain.value };
}
