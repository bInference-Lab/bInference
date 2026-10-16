import type { AssetRef, ChainRegistry, RegisteredChain, Signer } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
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

// Whether a launchpad holds the token on a curve with contracts of its own launch; `unread` when a
// launchpad's read failed, so no wallet can be picked for it (decision 0218).
async function isOnLaunchCurve(
  routing: LaunchRouting,
  token: AssetRef | undefined,
  signal: AbortSignal,
): Promise<boolean | "unread"> {
  if (token === undefined) {
    return false;
  }
  const claims = await routing.host.curves(token, { signal });
  if (!claims.ok) {
    return "unread";
  }
  return claims.value.some((claim) => Object.keys(claim.launch ?? {}).length > 0);
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
// own launch, or a sale or a swap of an unlisted token the launch wallet holds; `unread` when the
// curve read failed.
async function isLaunchTrade(
  routing: LaunchRouting,
  trade: RoutedTrade & { readonly wallet: Id<"wal"> },
  signal: AbortSignal,
): Promise<boolean | "unread"> {
  const onCurve = await isOnLaunchCurve(routing, trade.placed, signal);
  return onCurve === false ? holdsSold(routing, trade, signal) : onCurve;
}

/**
 * The wallet a proposal that names none runs from (decision 0217): for a live intent, the agent's
 * live launch wallet for a buy or a sale of a token a launchpad holds on a curve with contracts of
 * its own launch, or for a sale or a swap of a token the registry does not list that the launch
 * wallet holds, a graduated token's sale through the pools among them; else its oldest live
 * wallet that is no launch wallet. A paper intent signs nothing, so it runs from that default
 * wallet. `owned` is the agent's live wallets, oldest first. Without routing, the oldest. A live
 * trade of an agent with a launch wallet whose curve read failed is `launch_unread`: it runs from
 * no wallet (decision 0218).
 */
export async function routedWalletOf(
  routing: LaunchRouting | undefined,
  trade: RoutedTrade & { readonly owned: readonly Id<"wal">[] },
  signal: AbortSignal,
): Promise<Result<Id<"wal"> | undefined, "launch_unread">> {
  if (routing === undefined) {
    return ok(trade.owned[0]);
  }
  const launch = await launchWalletOf(routing.install, trade.agent, { signal });
  const fallback = trade.owned.find((wallet) => wallet !== launch?.id);
  if (launch === undefined || trade.isPaper) {
    return ok(fallback);
  }
  const isLaunch = await isLaunchTrade(routing, { ...trade, wallet: launch.id }, signal);
  if (isLaunch === "unread") {
    return err("launch_unread");
  }
  return ok(isLaunch ? launch.id : fallback);
}
