import {
  type AccountRef,
  assetRefParts,
  type ChainRegistry,
  type RegisteredChain,
  type Signer,
  type TxSimulator,
} from "@binference/chain";
import { type Clock, err, type Id, type IdSource, ok, type Result } from "@binference/core";
import type { LaunchTokenRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import { launchWalletOf } from "../install/launch-wallet.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { PolicyCheck } from "../policy/check-policy.js";
import type { AgentStore, InstallStore, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { HostedLaunch } from "../venues/launch-calls.js";
import type { LaunchHost } from "../venues/launch-host.js";
import type { LaunchSetting } from "../venues/launch-settings.schema.js";
import type { LaunchImageSource } from "./ports.js";
import type { ReadTokenCode } from "./token-code.js";
import type { WalletFacts } from "./wallet-facts.js";

/** What only a token launch needs beyond the money path's ports (decision 0234). */
interface TokenLaunchParts {
  readonly host: LaunchHost;
  /** The owner's uploads, which a launch's picture comes from; without it none is readable. */
  readonly images?: LaunchImageSource;
  /** Runs a launch's steps unsent on its chain, on the launch wallet's live balances. */
  readonly simulator: TxSimulator;
  /** Reads whether the token a launch names holds code yet: it must not (decision 0238). */
  readonly readCode: ReadTokenCode;
  /** Where the owner's notice of a launch that stopped goes. */
  readonly publish: PublishPush;
  /** How long a launch waits for its pin after the upload: 5 minutes when absent. */
  readonly pinWaitMs?: number;
}

/** The ports a token launch runs on: the money path's, and its own. */
export interface LaunchPathOptions {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  readonly wallets: WalletFactsSource;
  readonly custody: Pick<Signer, "account">;
  readonly chains: ChainRegistry;
  readonly policy: PolicyCheck;
  /** The install's wallets, which name the agent's launch wallet; without them it has none. */
  readonly install?: Pick<InstallStore, "read">;
  /** Whether the engine is locked; a launch's card says so while it is. */
  readonly isLocked: () => boolean;
  readonly launch: TokenLaunchParts;
  readonly clock: Clock;
  readonly ids: IdSource;
}

/** A launch resolved against its agent and its launchpad, before anything is stored. */
export interface ResolvedLaunch {
  readonly request: LaunchTokenRequest;
  readonly settings: AgentSettings;
  readonly chain: RegisteredChain;
  readonly launchSettings: readonly LaunchSetting[];
  readonly wallet: Id<"wal">;
  readonly account: AccountRef;
  /** The wallet is the agent's live launch wallet, the only one a live launch runs from. */
  readonly isLaunchWallet: boolean;
  readonly isPaper: boolean;
  readonly facts: WalletFacts;
}

/** The launch as the launch host takes it, from the wallet it was resolved for. */
export function hostedLaunchOf(resolved: ResolvedLaunch): HostedLaunch {
  const { request, account, launchSettings } = resolved;
  const { venue, name, symbol, pairWith, firstBuy, description, links } = request;
  return {
    venue,
    wallet: account,
    name,
    symbol,
    pair: pairWith,
    settings: launchSettings,
    ...(firstBuy === undefined ? {} : { firstBuy }),
    ...(description === undefined ? {} : { description }),
    ...(links === undefined ? {} : { links }),
  };
}

/** What a launch is resolved with: the registry, its launchpad's host, the wallets and custody. */
export type ResolveLaunchOptions = Pick<
  LaunchPathOptions,
  "chains" | "wallets" | "install" | "custody"
> & { readonly launch: Pick<TokenLaunchParts, "host"> };

interface Resolving {
  readonly request: LaunchTokenRequest;
  readonly settings: AgentSettings;
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

// A named wallet must be the agent's; a live launch takes the agent's launch wallet, and a paper
// one, or an agent with none, the agent's default wallet, to end it as the policy or the launch
// wallet rule says (decision 0234).
async function walletOf(
  options: ResolveLaunchOptions,
  resolving: Resolving,
): Promise<{ readonly wallet: Id<"wal">; readonly isLaunchWallet: boolean } | undefined> {
  const { request, isPaper, signal } = resolving;
  const owned = await options.wallets.wallets(request.agent, { signal });
  const { install } = options;
  const launch =
    install === undefined ? undefined : await launchWalletOf(install, request.agent, { signal });
  const named = request.wallet;
  const picked =
    named ?? (isPaper ? undefined : launch?.id) ?? owned.find((wallet) => wallet !== launch?.id);
  return picked === undefined || !owned.includes(picked)
    ? undefined
    : { wallet: picked, isLaunchWallet: picked === launch?.id };
}

// What a launch card shows in full: a description of at most 1,000 characters and links of at
// most 200 (decision 0235), so the owner never confirms words the card cut.
const descriptionMost = 1_000;
const linkMost = 200;

const characters = (text: string | undefined): number => Array.from(text ?? "").length;

// The first buy spends the pair the token launches against, so the card's pair and first buy say
// one thing (decision 0239); the words fit the card whole.
function isWhole(request: LaunchTokenRequest): boolean {
  const { firstBuy, pairWith, description, links } = request;
  const linkTexts = [links?.website, links?.x, links?.telegram];
  return (
    (firstBuy === undefined || firstBuy.asset === pairWith) &&
    characters(description) <= descriptionMost &&
    linkTexts.every((link) => characters(link) <= linkMost)
  );
}

/**
 * Resolves a token launch before anything is stored: its first buy spends its pair, and its
 * description and links fit the card whole (else `protocol.bad_args`, decision 0239); its chain
 * is the pair's, its launchpad one the engine hosts that launches tokens there (else
 * `quote.no_route`), its launchpad settings pass their declaration and its words fit what the
 * launchpad writes on chain (else `protocol.bad_args`), and its wallet is one of the agent's with
 * an account on the chain (else `wallet.not_found`), with that wallet's facts in the intent's
 * mode.
 */
export async function resolveLaunch(
  options: ResolveLaunchOptions,
  resolving: Resolving,
): Promise<Result<ResolvedLaunch, ProtocolErrorCode>> {
  const { request, settings, isPaper, signal } = resolving;
  if (!isWhole(request)) {
    return err("protocol.bad_args");
  }
  const chain = options.chains.get(assetRefParts(request.pairWith).chain);
  if (!chain.ok) {
    return err("quote.no_route");
  }
  const launchSettings = options.launch.host.settingsOf(
    request.venue,
    chain.value.ref,
    request.venueOptions,
  );
  if (!launchSettings.ok) {
    return err(launchSettings.error === "no_launchpad" ? "quote.no_route" : "protocol.bad_args");
  }
  // A launchpad that writes the words on chain takes only as many bytes as its create call does
  // (decision 0275), so a launch over them is refused before anything is stored or sent.
  if (!options.launch.host.fitsWords(request.venue, request)) {
    return err("protocol.bad_args");
  }
  const picked = await walletOf(options, resolving);
  const account =
    picked === undefined
      ? undefined
      : await options.custody.account(picked.wallet, chain.value.ref, { signal });
  if (picked === undefined || account?.ok !== true) {
    return err("wallet.not_found");
  }
  const { wallet } = picked;
  const query = { agent: request.agent, wallet, account: account.value, isPaper };
  const facts = await options.wallets.facts(query, { signal });
  return ok({
    request,
    settings,
    chain: chain.value,
    launchSettings: launchSettings.value,
    ...picked,
    account: account.value,
    isPaper,
    facts,
  });
}
