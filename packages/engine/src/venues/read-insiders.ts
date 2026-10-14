import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { maxInsiders } from "@binference/protocol";
import { z } from "zod";
import { callVenue, ownCopy, type VenueCallOptions } from "./call-venue.js";
import type { HostedVenue } from "./hosted-venue.js";

const insidersSchema: z.ZodType<readonly AccountRef[], readonly string[]> = z
  .array(accountRefSchema)
  .readonly();

// Accounts of the token's chain, each once: anything else is an answer the host cannot use.
function isUsable(insiders: readonly AccountRef[], token: AssetRef): boolean {
  const { chain } = assetRefParts(token);
  const isOnChain = insiders.every((insider) => accountRefParts(insider).chain === chain);
  return isOnChain && new Set(insiders).size === insiders.length;
}

/**
 * The wallets a hosted venue's contracts favor on a token it launched, asked with its registry
 * contracts on the token's chain under the host's timeout. A venue the host does not hold, one
 * that names no insiders, or one that does not trade on the token's chain names none. One that
 * throws, times out, or answers anything but accounts of the token's chain, each once, is
 * `venue_down`. It keeps the first {@link maxInsiders} the venue names, so a launch that favors
 * thousands of wallets stores a few. Rejects with the signal's reason once it aborts.
 */
export async function readInsiders(
  hosted: HostedVenue | undefined,
  token: AssetRef,
  call: VenueCallOptions,
): Promise<Result<readonly AccountRef[], "venue_down">> {
  const venue = hosted?.venue;
  const contracts = hosted?.contracts.get(assetRefParts(token).chain);
  if (venue?.insiders === undefined || contracts === undefined) {
    return ok([]);
  }
  const asked = Object.freeze({ token, contracts });
  const answer = await callVenue(async (signal) => {
    const named = await venue.insiders?.(asked, { signal });
    return named ?? [];
  }, call);
  const insiders = answer.ok ? ownCopy(insidersSchema, answer.value) : undefined;
  return insiders !== undefined && isUsable(insiders, token)
    ? ok(insiders.slice(0, maxInsiders))
    : err("venue_down");
}
