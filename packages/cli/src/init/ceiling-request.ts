import type {
  AssetRef,
  CeilingCapsDefinition,
  ChainDefinition,
  ChainRegistry,
  VenueDeclaration,
} from "@binference/chain";
import { erc20AssetRef, evmChainOf, parseEvmAddress } from "@binference/chain-evm";
import { bsc, bscCeilingCaps } from "@binference/chains";
import { BinferenceError, type Http, ok } from "@binference/core";
import {
  type CeilingChainPlan,
  type ChainCapPlan,
  registryCeilingChain,
} from "@binference/custody-privy";
import { flapDeclaration } from "@binference/flap";
import { createKyberswapVenue } from "@binference/kyberswap";
import { okxDeclaration } from "@binference/okx";
import type { VenuesConfig } from "../config/schema/chains-venues.schema.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { baseUnitsOf } from "./base-units.js";
import { type InitStep, refused } from "./init-context.js";

/**
 * The core venues this binference installs, by what each declares: its id and its registry
 * contracts per chain. KyberSwap and the Flap launchpad need no key; OKX is installed only when
 * `venues.keys.okx` names the owner's key. Each venue is made only to read its declaration;
 * nothing is called, no chain is read and no key is read.
 */
export function coreVenues(http: Http, venues: VenuesConfig): readonly VenueDeclaration[] {
  const chain = evmChainOf(bsc);
  const kyberswap = createKyberswapVenue({
    http,
    clientId: () => venues.kyberClientId,
    chains: [{ chain: chain.ref, nativeAsset: chain.nativeAsset, allowedHooks: [] }],
  });
  const keyless = [
    { id: kyberswap.id, contracts: kyberswap.contracts },
    flapDeclaration([chain.ref]),
  ];
  return venues.keys.okx === undefined
    ? keyless
    : [...keyless, okxDeclaration([{ chain: chain.ref, nativeAsset: chain.nativeAsset }])];
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

/** What a wallet's ceiling is built from before Privy holds the aggregations of its caps. */
export interface CeilingDraft {
  readonly chains: readonly CeilingChainPlan[];
  /** Each chain's 24-hour caps, in the order of `chains`. */
  readonly capPlans: readonly ChainCapPlan[];
  readonly rescue: string;
  readonly saved: readonly string[];
}

// What each chain this binference serves caps per rolling 24 hours (decision 0149).
const ceilingCapsByChain: ReadonlyMap<string, CeilingCapsDefinition> = new Map([
  [bsc.id, bscCeilingCaps],
]);

// Twice the agent-wide daily cap: a speed-up or a reverted transaction counts again at Privy.
const capHeadroom = 2n;

function unbuilt(chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "cli.ceiling_unbuilt",
    message: `The registry gives no ceiling caps on ${chain}.`,
    details: { chain, problem },
  });
}

/** One asset a chain's 24-hour caps count, and the floor price its cap is sized at. */
export interface CapAsset {
  readonly asset: AssetRef;
  readonly decimals: number;
  /** The least one whole unit counts at when a cap is sized from dollars, in micro-dollars. */
  readonly floorUsd: bigint;
}

/**
 * What one chain's 24-hour caps count (decision 0149): the native coin its transactions send, and
 * each capped token's approvals in the order the chain's data lists them, which is the order of
 * the aggregations init makes and of the caps a ceiling's approval rule names.
 */
export interface CapAssets {
  readonly native: CapAsset;
  readonly tokens: readonly (CapAsset & { readonly token: string })[];
}

// The cap assets of one chain. A chain whose data names no caps, or a capped token its registry
// lacks, is a fault of this build.
function capAssetsOf(definition: ChainDefinition): CapAssets {
  const caps = ceilingCapsByChain.get(definition.id);
  if (caps === undefined) {
    throw unbuilt(definition.id, "no_caps");
  }
  const chain = evmChainOf(definition);
  const tokens = caps.tokens.map((item) => {
    const token = definition.tokens.find((each) => each.symbol === item.symbol);
    const address = token === undefined ? undefined : parseEvmAddress(token.address);
    if (token === undefined || address?.ok !== true) {
      throw unbuilt(definition.id, "unknown_token");
    }
    const asset = erc20AssetRef(chain, address.value);
    return { asset, token: token.address, decimals: token.decimals, floorUsd: item.floorUsd };
  });
  const native = {
    asset: chain.nativeAsset,
    decimals: chain.nativeDecimals,
    floorUsd: caps.nativeFloorUsd,
  };
  return { native, tokens };
}

/**
 * The {@link CapAssets} of a chain of the registry; undefined for a chain it lacks. A chain whose
 * data names no caps, or a capped token its registry lacks, is a fault of this build.
 */
export function capAssetsOn(registry: ChainRegistry, chain: string): CapAssets | undefined {
  const registered = registry.list().find((item) => item.ref === chain);
  return registered === undefined ? undefined : capAssetsOf(registered.definition);
}

/**
 * The size of each 24-hour cap init makes (decision 0149): twice `defaults.limits.rollingDayUsd`,
 * since a speed-up or a reverted transaction counts again at Privy, in micro-dollars.
 */
export function initialDayCapUsd(config: Pick<BinferenceConfig, "defaults">): bigint {
  return capHeadroom * config.defaults.limits.rollingDayUsd;
}

/**
 * One chain's 24-hour caps, each the dollars given in its unit at the floor price the chain's data
 * names, rounded up (decisions 0149 and 0151). A chain whose data names no caps, or a capped token
 * its registry lacks, is a fault of this build.
 */
export function capPlanOf(definition: ChainDefinition, dayUsdMicros: bigint): ChainCapPlan {
  const unitsOf = (item: CapAsset) =>
    (dayUsdMicros * 10n ** BigInt(item.decimals) + item.floorUsd - 1n) / item.floorUsd;
  const { native, tokens } = capAssetsOf(definition);
  const approvals = tokens.map((item) => ({ token: item.token, limitBase: unitsOf(item) }));
  return { chain: evmChainOf(definition), nativeLimitBase: unitsOf(native), approvals };
}

function ceilingChainOf(
  registry: ChainRegistry,
  config: Pick<BinferenceConfig, "chains" | "defaults">,
  request: {
    readonly chain: string;
    readonly venues: readonly VenueDeclaration[];
    readonly isLaunch: boolean;
  },
): InitStep<{ readonly plan: CeilingChainPlan; readonly caps: ChainCapPlan }> {
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
    isLaunch: request.isLaunch,
  });
  if (!chain.ok) {
    // A venue that names a contract its chain's registry lacks is a fault of this build.
    throw new BinferenceError({
      code: "cli.venue_contract_missing",
      message: `A venue names a contract the registry of ${request.chain} does not hold.`,
      details: { chain: request.chain, problem: chain.error },
    });
  }
  return ok({ plan: chain.value, caps: capPlanOf(definition, initialDayCapUsd(config)) });
}

/**
 * What the first wallet's ceiling is built from (keys spec, section 4; decision 0149): on each
 * enabled chain, the functions and spenders the enabled venues declare, the per-transaction cap
 * of `defaults.ceiling.perTxBnb` and the chain's 24-hour caps; sends only to the rescue address,
 * as no address is saved yet.
 */
export function ceilingRequestOf(
  registry: ChainRegistry,
  config: Pick<BinferenceConfig, "chains" | "defaults">,
  ceiling: {
    readonly venues: readonly VenueDeclaration[];
    readonly rescue: string;
    /** A launch wallet's, which also allows the calls only a launch wallet makes; absent, not. */
    readonly isLaunch?: boolean;
  },
): InitStep<CeilingDraft> {
  const chains: CeilingChainPlan[] = [];
  const capPlans: ChainCapPlan[] = [];
  for (const chain of config.chains.enabled) {
    const isLaunch = ceiling.isLaunch === true;
    const made = ceilingChainOf(registry, config, { chain, venues: ceiling.venues, isLaunch });
    if (!made.ok) {
      return made;
    }
    chains.push(made.value.plan);
    capPlans.push(made.value.caps);
  }
  return ok({ chains, capPlans, rescue: ceiling.rescue, saved: [] });
}
