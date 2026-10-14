import type { AssetRef, ChainRegistry, RegisteredChain, Signer } from "@binference/chain";
import type { Id } from "@binference/core";
import { launchWalletOf } from "../install/launch-wallet.js";
import type { InstallStore } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
import { assetInfoOf } from "./asset-infos.js";
import type { Holdings } from "./wallet-facts.js";

/**
 * What routes a trade to the agent's launch wallet (decision 0217): the install's wallets, the
 * launchpads' curve reads, custody's accounts, what a wallet holds and the registry's tokens.
 */
export interface LaunchRouting {
  readonly install: Pick<InstallStore, "read">;
  readonly host: Pick<VenueHost, "curves">;
  readonly custody: Pick<Signer, "account">;
  readonly holdings: Holdings;
  readonly chains: ChainRegistry;
}

/** A trade to route: what it places on a launchpad's curve, and what it sells, on its chain. */
export interface RoutedTrade {
  readonly agent: Id<"agt">;
  readonly chain: RegisteredChain;
  /** The intent runs on paper: the launch wallet's holding is its paper position. */
  readonly isPaper: boolean;
  /** The token a buy or a sale trades, whose place picks the venues; absent for a swap. */
  readonly placed?: AssetRef;
  /** What a sale or a swap sells; absent for a buy. */
  readonly sold?: AssetRef;
}

// Whether a launchpad holds the token on a curve with contracts of its own launch. A read that
// fails says nothing: the trade's own quote then meets the same doubt (decision 0179).
async function isOnLaunchCurve(
  routing: LaunchRouting,
  token: AssetRef | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  if (token === undefined) {
    return false;
  }
  const claims = await routing.host.curves(token, { signal });
  return claims.ok && claims.value.some((claim) => Object.keys(claim.launch ?? {}).length > 0);
}

// Whether the launch wallet holds some of the token the trade sells, in the trade's mode: a token
// the registry does not list, as the tokens it buys on launch curves are. The chain's coin and the
// registry's tokens sell from the default wallet.
async function holdsSold(
  routing: LaunchRouting,
  trade: RoutedTrade & { readonly wallet: Id<"wal"> },
  signal: AbortSignal,
): Promise<boolean> {
  const { sold } = trade;
  if (sold === undefined || assetInfoOf(routing.chains, sold) !== undefined) {
    return false;
  }
  const account = await routing.custody.account(trade.wallet, trade.chain.ref, { signal });
  if (!account.ok) {
    return false;
  }
  const query = { wallet: trade.wallet, account: account.value, isPaper: trade.isPaper };
  const held = await routing.holdings.held({ ...query, asset: sold }, { signal });
  return held !== undefined && held > 0n;
}

// Whether the trade runs from the launch wallet: a buy or a sale on a curve with contracts of its
// own launch, or a sale or a swap of an unlisted token the launch wallet holds.
async function isLaunchTrade(
  routing: LaunchRouting,
  trade: RoutedTrade & { readonly wallet: Id<"wal"> },
  signal: AbortSignal,
): Promise<boolean> {
  return (
    (await isOnLaunchCurve(routing, trade.placed, signal)) ||
    (await holdsSold(routing, trade, signal))
  );
}

/**
 * The wallet a proposal that names none runs from (decision 0217): for a live intent, the agent's
 * live launch wallet for a buy or a sale of a token a launchpad holds on a curve with contracts of
 * its own launch, or for a sale or a swap of a token the registry does not list that the launch
 * wallet holds, a graduated token's sale through the pools among them; else its oldest live
 * wallet that is no launch wallet. A paper intent signs nothing, so it runs from that default
 * wallet. `owned` is the agent's live wallets, oldest first. Without routing, the oldest.
 */
export async function routedWalletOf(
  routing: LaunchRouting | undefined,
  trade: RoutedTrade & { readonly owned: readonly Id<"wal">[] },
  signal: AbortSignal,
): Promise<Id<"wal"> | undefined> {
  if (routing === undefined) {
    return trade.owned[0];
  }
  const launch = await launchWalletOf(routing.install, trade.agent, { signal });
  const isLive = launch !== undefined && !trade.isPaper;
  if (isLive && (await isLaunchTrade(routing, { ...trade, wallet: launch.id }, signal))) {
    return launch.id;
  }
  return trade.owned.find((wallet) => wallet !== launch?.id);
}
