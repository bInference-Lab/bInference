import {
  type AccountRef,
  type ChainRef,
  type ChainRegistry,
  accountRefSchema,
  type Venue,
  type VenueContracts,
  venueDeclarationSchema,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";

/** A venue the host holds, with its declared contracts read from the chain registry. */
export interface HostedVenue {
  readonly venue: Venue;
  /** The venue's contracts on each chain it serves, by name. */
  readonly contracts: ReadonlyMap<ChainRef, Readonly<Record<string, AccountRef>>>;
}

function refuse(id: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "venue.bad_declaration",
    message: `The venue ${id} cannot be hosted: ${problem}`,
    details: { venue: id },
  });
}

// Rule 10: a venue's contract addresses come only from the registry, which checked each on chain.
function contractsOn(
  venue: Venue,
  declared: VenueContracts,
  chains: ChainRegistry,
): Readonly<Record<string, AccountRef>> {
  const chain = chains.get(declared.chain);
  if (!chain.ok) {
    throw refuse(
      venue.id,
      `it declares ${declared.chain}, which the chain registry does not hold.`,
    );
  }
  const listed = chain.value.definition.contracts.filter((item) => item.venue === venue.id);
  const entries = declared.names.map((name): [string, AccountRef] => {
    const contract = listed.find((item) => item.name === name);
    if (contract === undefined) {
      throw refuse(venue.id, `the registry lists no contract ${name} for it on ${declared.chain}.`);
    }
    return [name, accountRefSchema.parse(`${declared.chain}:${contract.address}`)];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function host(venue: Venue, chains: ChainRegistry): HostedVenue {
  const declaration = venueDeclarationSchema.safeParse(venue);
  if (!declaration.success) {
    throw refuse(venue.id, z.prettifyError(declaration.error));
  }
  const contracts = declaration.data.contracts.map(
    (declared): [ChainRef, Readonly<Record<string, AccountRef>>] => [
      declared.chain,
      contractsOn(venue, declared, chains),
    ],
  );
  return { venue, contracts: new Map(contracts) };
}

/**
 * Checks every venue's declaration against the chain registry and keys the venues by id. A bad
 * declaration, a chain the registry does not hold, a contract name the registry does not list for
 * the venue on that chain, or two venues with one id is a fault: the engine refuses to start.
 */
export function hostVenues(
  venues: readonly Venue[],
  chains: ChainRegistry,
): ReadonlyMap<string, HostedVenue> {
  const hosted = new Map(venues.map((venue) => [venue.id, host(venue, chains)]));
  if (hosted.size !== venues.length) {
    throw new BinferenceError({
      code: "venue.duplicate_venue",
      message: "Two venues share an id.",
    });
  }
  return hosted;
}
