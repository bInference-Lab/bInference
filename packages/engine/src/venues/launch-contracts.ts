import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import { ok, type Result } from "@binference/core";
import type { VenueCallOptions } from "./call-venue.js";
import type { HostedVenue } from "./hosted-venue.js";
import { askLaunchpad, type CurveClaim, type HostedLaunchpad, isLaunchpad } from "./read-curves.js";

/** The contracts of one launch, such as a token's curve, by the names its launchpad declares. */
export type LaunchContracts = Readonly<Record<string, AccountRef>>;

/**
 * A request's contracts with a launch's added, each under a name the venue declares as a launch's
 * on the chain (decision 0212). A name it does not declare there makes the launch unusable:
 * `undefined`. No launch leaves the contracts as they are.
 */
export function contractsWithLaunch(
  contracts: Readonly<Record<string, AccountRef>>,
  launch: LaunchContracts | undefined,
  names: ReadonlySet<string> | undefined,
): Readonly<Record<string, AccountRef>> | undefined {
  if (launch === undefined) {
    return contracts;
  }
  const isDeclared = Object.keys(launch).every((name) => names?.has(name) === true);
  return isDeclared ? Object.freeze({ ...contracts, ...launch }) : undefined;
}

// The first token, in order, the launchpad holds on its curve; a read that fails stops the search.
async function firstClaim(
  launchpad: HostedLaunchpad,
  tokens: readonly AssetRef[],
  call: VenueCallOptions,
): Promise<Result<CurveClaim | undefined, "venue_down">> {
  const [token, ...rest] = tokens;
  if (token === undefined) {
    return ok(undefined);
  }
  const claim = await askLaunchpad(launchpad, token, call);
  return !claim.ok || claim.value !== undefined ? claim : firstClaim(launchpad, rest, call);
}

/**
 * The contracts of the launch a trade's token belongs to (decision 0212). A venue that declares no
 * launch contracts on the chain, or a launchpad that holds neither token, gives none. Otherwise
 * the launchpad's curve read is asked about the token bought, then the token sold, the chain's
 * coin never; a read that throws, times out or names an undeclared launch contract is
 * `venue_down`.
 */
export async function tradeLaunchOf(
  hosted: HostedVenue,
  trade: { readonly chain: ChainRef; readonly tokens: readonly AssetRef[] },
  call: VenueCallOptions,
): Promise<Result<LaunchContracts | undefined, "venue_down">> {
  const { venue } = hosted;
  if (!hosted.launchNames.has(trade.chain) || !isLaunchpad(venue)) {
    return ok(undefined);
  }
  const claim = await firstClaim({ ...hosted, venue }, trade.tokens, call);
  return claim.ok ? ok(claim.value?.launch) : claim;
}
