import type { ChainRegistry } from "@binference/chain";
import type { Id, JsonValue } from "@binference/core";
import type { WalletRecord } from "../install/install-record.js";

/** What a `limit/set` adding venues is checked against: the registry and the wallets. */
export interface VenueCheck {
  readonly agent: Id<"agt">;
  readonly venues: readonly string[];
  readonly wallets: readonly WalletRecord[];
  readonly chains: ChainRegistry;
}

function valuesOf(json: JsonValue): readonly JsonValue[] {
  return json === null || typeof json !== "object" ? [] : Object.values(json);
}

// Whether a mirrored policy names an address in any of its values, in any letter case.
function mentions(policy: JsonValue, address: string): boolean {
  return typeof policy === "string"
    ? policy.toLowerCase().includes(address.toLowerCase())
    : valuesOf(policy).some((value) => mentions(value, address));
}

// The registry contracts of a venue on the chains of one wallet's family.
function contractsOf(chains: ChainRegistry, venue: string, family: string): readonly string[] {
  return chains
    .list()
    .filter((chain) => chain.definition.family === family)
    .flatMap((chain) => chain.definition.contracts)
    .filter((contract) => contract.venue === venue)
    .map((contract) => contract.address);
}

/** The venues the registry holds no contract of: a `limit/set` naming one is malformed. */
export function unknownVenues(chains: ChainRegistry, venues: readonly string[]): readonly string[] {
  const known = new Set(
    chains
      .list()
      .flatMap((chain) => chain.definition.contracts)
      .map((contract) => contract.venue),
  );
  return venues.filter((venue) => !known.has(venue));
}

/**
 * The venues a live wallet of the agent cannot use because its ceiling, as last read back from
 * custody, names some registry contract of the venue nowhere (decision 0111). Only the owner key
 * adds a contract to a ceiling, so `limit/set` refuses them with `limit.over_ceiling`.
 */
export function venuesOutsideCeiling(check: VenueCheck): readonly string[] {
  const live = check.wallets.filter(
    (wallet) => wallet.agentId === check.agent && wallet.archivedAtMs === undefined,
  );
  return check.venues.filter((venue) =>
    live.some((wallet) =>
      contractsOf(check.chains, venue, wallet.family).some(
        (address) => !mentions(wallet.ceiling.policy, address),
      ),
    ),
  );
}
