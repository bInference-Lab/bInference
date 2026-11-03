import type { ComposeEngineOptions } from "./compose-engine.js";
import type { TradingParts } from "./compose-trading.js";
import { chainIdentityRegistries } from "./identity-registries.js";
import { chainNameResolvers } from "./name-resolvers.js";
import { selfHostedRatePrices } from "./open-engine-parts.js";
import { chainStakingVenues } from "./staking-venues.js";
import { chainTokenReads } from "./token-facts.js";

/**
 * What the self-hosted engine reads on the chains besides prices: tokens' facts, names, staking
 * venues and identity registries, whose registration files carry the release version.
 */
export function chainReadParts(
  reads: TradingParts["reads"],
  version: string,
): Pick<
  ComposeEngineOptions,
  "readTokenFacts" | "readTokenCode" | "nameResolvers" | "stakingVenues" | "identity"
> {
  return {
    ...chainTokenReads(reads),
    nameResolvers: chainNameResolvers(reads),
    stakingVenues: chainStakingVenues(reads, selfHostedRatePrices()),
    identity: { registries: chainIdentityRegistries(reads), version },
  };
}
