import {
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
}

/** Whether a venue is a launchpad: it reads its curve. */
export function isLaunchpad(venue: Venue): venue is LaunchpadVenue {
  return venue.curve !== undefined;
}

// A launchpad's answer the host trusts: of its types, and naming another asset of the token's chain.
function claimOf(
  launchpad: string,
  token: AssetRef,
  holding: CurveHolding | undefined,
): Result<CurveClaim | undefined, "venue_down"> {
  if (holding === undefined) {
    return err("venue_down");
  }
  if (!holding.onCurve) {
    return ok(undefined);
  }
  const { quoteAsset } = holding;
  const isSameChain = assetRefParts(quoteAsset).chain === assetRefParts(token).chain;
  return isSameChain && quoteAsset !== token ? ok({ launchpad, quoteAsset }) : err("venue_down");
}

async function askLaunchpad(
  launchpad: LaunchpadVenue,
  request: { readonly token: AssetRef; readonly contracts: HostedVenue["contracts"] },
  call: VenueCallOptions,
): Promise<Result<CurveClaim | undefined, "venue_down">> {
  const { token } = request;
  const contracts = request.contracts.get(assetRefParts(token).chain);
  if (contracts === undefined) {
    return ok(undefined);
  }
  const asked = Object.freeze({ token, contracts });
  const answer = await callVenue(async (signal) => launchpad.curve(asked, { signal }), call);
  return claimOf(
    launchpad.id,
    token,
    answer.ok ? ownCopy(curveHoldingSchema, answer.value) : undefined,
  );
}

/**
 * Asks every hosted launchpad on the token's chain, all at once, whether the token is on its curve
 * now (spec 6, section 5), and answers those that hold it. A launchpad that throws, times out,
 * answers outside its types, or names a quote asset off the token's chain is `venue_down`, and so
 * is the whole read: a token whose place is in doubt never goes to the pools. Rejects with the
 * signal's reason once it aborts.
 */
export async function readCurves(
  token: AssetRef,
  venues: ReadonlyMap<string, HostedVenue>,
  call: VenueCallOptions,
): Promise<Result<readonly CurveClaim[], "venue_down">> {
  const answers = await Promise.all(
    [...venues.values()].map(async ({ venue, contracts }) =>
      isLaunchpad(venue) ? askLaunchpad(venue, { token, contracts }, call) : ok(undefined),
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
