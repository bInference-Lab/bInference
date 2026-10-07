import type { ChainRegistry, VenueDeclaration } from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { BinferenceError, type Http, ok } from "@binference/core";
import {
  type CeilingChain,
  type CeilingRequest,
  registryCeilingChain,
} from "@binference/custody-privy";
import { createKyberswapVenue } from "@binference/kyberswap";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { baseUnitsOf } from "./base-units.js";
import { type InitStep, refused } from "./init-context.js";

/**
 * The core venues this binference installs, by what each declares: its id and its registry
 * contracts per chain. Each venue is made only to read its declaration; nothing is called.
 */
export function coreVenues(http: Http, kyberClientId: string): readonly VenueDeclaration[] {
  const chain = evmChainOf(bsc);
  const kyberswap = createKyberswapVenue({
    http,
    clientId: kyberClientId,
    chains: [{ chain: chain.ref, nativeAsset: chain.nativeAsset, allowedHooks: [] }],
  });
  return [{ id: kyberswap.id, contracts: kyberswap.contracts }];
}

/**
 * The venues a new agent may use: the config's `defaults.limits.venues`, else every core venue.
 * A name no core venue has stops init.
 */
export function enabledVenues(
  config: BinferenceConfig,
  installed: readonly VenueDeclaration[],
): InitStep<readonly VenueDeclaration[]> {
  const named = config.defaults.limits.venues;
  if (named === undefined) {
    return ok(installed);
  }
  const unknown = named.find((name) => !installed.some((venue) => venue.id === name));
  return unknown === undefined
    ? ok(installed.filter((venue) => named.includes(venue.id)))
    : refused("init.unknown_venue", "refused.unknownVenue", { venue: unknown });
}

function ceilingChainOf(
  registry: ChainRegistry,
  config: BinferenceConfig,
  request: { readonly chain: string; readonly venues: readonly VenueDeclaration[] },
): InitStep<CeilingChain> {
  const registered = registry.list().find((item) => item.ref === request.chain);
  if (registered === undefined) {
    return refused("init.unknown_chain", "refused.unknownChain", { chain: request.chain });
  }
  const { definition } = registered;
  const capText = config.defaults.ceiling.perTxBnb;
  const cap = baseUnitsOf(capText, evmChainOf(definition).nativeDecimals);
  if (cap === undefined) {
    return refused("init.bad_ceiling_cap", "refused.badCeilingCap", { cap: capText });
  }
  const chain = registryCeilingChain({
    definition,
    venues: request.venues,
    perTxNativeCapBase: cap,
  });
  if (!chain.ok) {
    // A venue that names a contract its chain's registry lacks is a fault of this build.
    throw new BinferenceError({
      code: "cli.venue_contract_missing",
      message: `A venue names a contract the registry of ${request.chain} does not hold.`,
      details: { chain: request.chain },
    });
  }
  return chain;
}

/**
 * What the first wallet's ceiling is built from (keys spec, section 4): on each enabled chain,
 * the enabled venues' registry contracts and the per-transaction cap of
 * `defaults.ceiling.perTxBnb`; sends only to the rescue address, as no address is saved yet.
 */
export function ceilingRequestOf(
  registry: ChainRegistry,
  config: BinferenceConfig,
  ceiling: { readonly venues: readonly VenueDeclaration[]; readonly rescue: string },
): InitStep<CeilingRequest> {
  const chains: CeilingChain[] = [];
  for (const chain of config.chains.enabled) {
    const made = ceilingChainOf(registry, config, { chain, venues: ceiling.venues });
    if (!made.ok) {
      return made;
    }
    chains.push(made.value);
  }
  return ok({ chains, rescue: ceiling.rescue, saved: [] });
}
