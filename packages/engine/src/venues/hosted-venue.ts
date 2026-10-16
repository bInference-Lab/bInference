import {
  type AccountRef,
  type ChainRef,
  type ChainRegistry,
  accountRefSchema,
  type Venue,
  type VenueContracts,
  venueDeclarationSchema,
} from "@binference/chain";
import { BinferenceError, type JsonValue } from "@binference/core";
import { z } from "zod";

/** A venue the host holds, with its declared contracts read from the chain registry. */
export interface HostedVenue {
  readonly venue: Venue;
  /** The venue's contracts on each chain it serves, by name. */
  readonly contracts: ReadonlyMap<ChainRef, Readonly<Record<string, AccountRef>>>;
  /** The chains on which the venue declares that its trade calls carry no deadline. */
  readonly noDeadline: ReadonlySet<ChainRef>;
  /**
   * The names of the contracts each launch of the venue has on each chain it declares them on: a
   * curve read may name their addresses for a token it holds, and under no other name.
   */
  readonly launchNames: ReadonlyMap<ChainRef, ReadonlySet<string>>;
  /** The JSON ABI entry of each call the venue declares on a launch's own contracts, any chain. */
  readonly launchCalls: readonly JsonValue[];
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
  const noDeadline = declaration.data.contracts
    .filter((declared) => declared.noDeadline === true)
    .map((declared) => declared.chain);
  const launchNames = declaration.data.contracts.flatMap(
    (declared): [ChainRef, ReadonlySet<string>][] =>
      declared.launchContracts === undefined
        ? []
        : [[declared.chain, new Set(declared.launchContracts)]],
  );
  const launchCalls = declaration.data.contracts.flatMap((declared) =>
    (declared.calls ?? [])
      .filter((call) => declared.launchContracts?.includes(call.contract) === true)
      .map((call) => call.abi),
  );
  return {
    venue,
    contracts: new Map(contracts),
    noDeadline: new Set(noDeadline),
    launchNames: new Map(launchNames),
    launchCalls,
  };
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

/**
 * The JSON ABI entry of each call one hosted venue declares on a launch's own contracts, or every
 * hosted venue's when `venue` is absent (decision 0218); none for a venue not hosted.
 */
export function launchCallsOf(
  venues: ReadonlyMap<string, HostedVenue>,
  venue: string | undefined,
): readonly JsonValue[] {
  const hosted = venue === undefined ? [...venues.values()] : [venues.get(venue)];
  return hosted.flatMap((item) => item?.launchCalls ?? []);
}
