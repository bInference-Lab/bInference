import type { ChainRef, VenueDeclaration } from "@binference/chain";
import type { ChainReads } from "./chain-reads.js";
import { selfHostedRatePrices } from "./open-engine-parts.js";
import { chainStakingVenues } from "./staking-venues.js";

/** What the venues a running engine plans ceilings from are gathered from. */
export interface CeilingVenueParts {
  /** The venues the engine quotes on. */
  readonly venues: readonly VenueDeclaration[];
  /** Each enabled chain's reads, on which the staking venues run. */
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** The bridges the engine bridges with. */
  readonly bridges: readonly VenueDeclaration[];
}

/**
 * The venues every ceiling the running engine writes is planned from, as init plans the first one
 * from the core venues: the venues it quotes on, the staking venues of the chains it reads and the
 * bridges, each once by its id, the first kept. `ceiling set`, a destination save and a new wallet
 * plan from them, so a rewrite keeps the rules of every venue the ceiling names.
 */
export function selfHostedCeilingVenues(parts: CeilingVenueParts): readonly VenueDeclaration[] {
  const staking = chainStakingVenues(parts.reads, selfHostedRatePrices());
  const all = [...parts.venues, ...staking, ...parts.bridges];
  return all.filter((venue, index) => all.findIndex((item) => item.id === venue.id) === index);
}
