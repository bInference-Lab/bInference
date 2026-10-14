import {
  type AccountRef,
  accountRefParts,
  type AssetRef,
  assetRefParts,
  type CurveHolding,
  curveHoldingSchema,
  type LaunchpadVenue,
  type Venue,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { callVenue, ownCopy, type VenueCallOptions } from "./call-venue.js";
import type { HostedVenue } from "./hosted-venue.js";

/** A launchpad that holds a token on its curve, and what its curve trades the token against. */
export interface CurveClaim {
  readonly launchpad: string;
  readonly quoteAsset: AssetRef;
  /**
   * The contracts of the token's own launch, by the names the launchpad declares, which the
   * token's trades and price reads on that launchpad may call (decision 0212).
   */
  readonly launch?: Readonly<Record<string, AccountRef>>;
}

/** A hosted venue that is a launchpad. */
export interface HostedLaunchpad extends HostedVenue {
  readonly venue: LaunchpadVenue;
}

/** Whether a venue is a launchpad: it reads its curve. */
export function isLaunchpad(venue: Venue): venue is LaunchpadVenue {
  return venue.curve !== undefined;
}

// A launch's contracts the host trusts: each under a name the launchpad declares on the token's
// chain, and on that chain.
function isDeclaredLaunch(
  launch: Readonly<Record<string, AccountRef>>,
  token: AssetRef,
  names: ReadonlySet<string> | undefined,
): boolean {
  const { chain } = assetRefParts(token);
  const isNamed = Object.keys(launch).every((name) => names?.has(name) === true);
  return isNamed && Object.values(launch).every((item) => accountRefParts(item).chain === chain);
}

// A launchpad's answer the host trusts: of its types, naming another asset of the token's chain,
// and any launch contract under a name the launchpad declares there.
function claimOf(
  hosted: HostedVenue,
  token: AssetRef,
  holding: CurveHolding | undefined,
): Result<CurveClaim | undefined, "venue_down"> {
  if (holding === undefined) {
    return err("venue_down");
  }
  if (!holding.onCurve) {
    return ok(undefined);
  }
  const { quoteAsset, launch } = holding;
  const { chain } = assetRefParts(token);
  const isSameChain = assetRefParts(quoteAsset).chain === chain;
  const names = hosted.launchNames.get(chain);
  if (!isSameChain || quoteAsset === token) {
    return err("venue_down");
  }
  if (launch === undefined) {
    return ok({ launchpad: hosted.venue.id, quoteAsset });
  }
  return isDeclaredLaunch(launch, token, names)
    ? ok({ launchpad: hosted.venue.id, quoteAsset, launch })
    : err("venue_down");
}

/**
 * Asks one hosted launchpad whether it holds a token on its curve now, with its registry contracts
 * on the token's chain. A launchpad that does not trade there holds nothing. A launchpad that
 * throws, times out, answers outside its types, names a quote asset off the token's chain, or names
 * a launch contract it does not declare there, is `venue_down`.
 */
export async function askLaunchpad(
  hosted: HostedLaunchpad,
  token: AssetRef,
  call: VenueCallOptions,
): Promise<Result<CurveClaim | undefined, "venue_down">> {
  const contracts = hosted.contracts.get(assetRefParts(token).chain);
  if (contracts === undefined) {
    return ok(undefined);
  }
  const asked = Object.freeze({ token, contracts });
  const answer = await callVenue(async (signal) => hosted.venue.curve(asked, { signal }), call);
  return claimOf(hosted, token, answer.ok ? ownCopy(curveHoldingSchema, answer.value) : undefined);
}

function isHostedLaunchpad(hosted: HostedVenue): hosted is HostedLaunchpad {
  return isLaunchpad(hosted.venue);
}

/**
 * Asks every hosted launchpad on the token's chain, all at once, whether the token is on its curve
 * now (spec 6, section 5), and answers those that hold it. A launchpad that throws, times out,
 * answers outside its types, names a quote asset off the token's chain or a launch contract it
 * does not declare, is `venue_down`, and so is the whole read: a token whose place is in doubt
 * never goes to the pools. Rejects with the signal's reason once it aborts.
 */
export async function readCurves(
  token: AssetRef,
  venues: ReadonlyMap<string, HostedVenue>,
  call: VenueCallOptions,
): Promise<Result<readonly CurveClaim[], "venue_down">> {
  const answers = await Promise.all(
    [...venues.values()].map(async (hosted) =>
      isHostedLaunchpad(hosted) ? askLaunchpad(hosted, token, call) : ok(undefined),
    ),
  );
  const claims: CurveClaim[] = [];
  for (const answer of answers) {
    if (!answer.ok) {
      return answer;
    }
    if (answer.value !== undefined) {
      claims.push(answer.value);
    }
  }
  return ok(claims);
}
