import type { ChainRegistry } from "@binference/chain";
import { type Id, type JsonValue, stableJson } from "@binference/core";
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
 * custody, names none of the venue's registry contracts (decisions 0111 and 0149): a ceiling
 * lists the contracts a venue's trades call and approve, never the ones only those reach. Only
 * the owner key adds a venue to a ceiling, so `limit/set` refuses them with `limit.over_ceiling`.
 */
export function venuesOutsideCeiling(check: VenueCheck): readonly string[] {
  const live = check.wallets.filter(
    (wallet) => wallet.agentId === check.agent && wallet.archivedAtMs === undefined,
  );
  return check.venues.filter((venue) =>
    live.some((wallet) => {
      const contracts = contractsOf(check.chains, venue, wallet.family);
      const named = contracts.some((address) => mentions(wallet.ceiling.policy, address));
      return contracts.length > 0 && !named;
    }),
  );
}

// Every value a mirrored policy holds, at any depth, in canonical text.
function valuesIn(policy: JsonValue): readonly string[] {
  return [stableJson(policy), ...valuesOf(policy).flatMap((value) => valuesIn(value))];
}

/**
 * The calls among `calls`, each a JSON ABI entry, that a wallet's ceiling, as last read back from
 * custody, does not allow: its rules hold each call they allow as that entry.
 */
export function callsOutsideCeiling(
  wallet: WalletRecord,
  calls: readonly JsonValue[],
): readonly JsonValue[] {
  const held = new Set(valuesIn(wallet.ceiling.policy));
  return calls.filter((abi) => !held.has(stableJson(abi)));
}

/**
 * The venues among `venues` that declare calls on each launch's own contracts the launch wallet's
 * ceiling, as last read back from custody, does not allow (decision 0218): its launch rules hold
 * each such call's JSON ABI entry, and a launchpad installed after the wallet was made has calls
 * they lack. Only the owner key changes the ceiling, so `limit/set` and `agent/goLive` refuse such
 * a venue with `limit.over_ceiling`.
 */
export function launchVenuesOutsideCeiling(check: {
  readonly venues: readonly string[];
  readonly launchWallet: WalletRecord;
  readonly launchCalls: (venue: string) => readonly JsonValue[];
}): readonly string[] {
  return check.venues.filter(
    (venue) => callsOutsideCeiling(check.launchWallet, check.launchCalls(venue)).length > 0,
  );
}
