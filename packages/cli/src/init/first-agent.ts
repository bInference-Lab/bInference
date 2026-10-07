import { type AssetRef, assetRefSchema, type ChainRegistry } from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { type Id, ok } from "@binference/core";
import type { AgentDraft, GasReserve, LimitsValues } from "@binference/engine";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { baseUnitsOf } from "./base-units.js";
import { type InitStep, refused } from "./init-context.js";

// The first agent's name, unique among the install's agents.
const firstAgentName = "main";

// A health factor of 1.5 is 15,000 basis points of 1.
const bpPerOne = 10_000;

function gasReserveOf(
  registry: ChainRegistry,
  reserves: Readonly<Record<string, string>>,
): InitStep<readonly GasReserve[]> {
  const found: GasReserve[] = [];
  for (const [chain, text] of Object.entries(reserves)) {
    const registered = registry.list().find((item) => item.ref === chain);
    const reserveBase =
      registered === undefined
        ? undefined
        : baseUnitsOf(text, evmChainOf(registered.definition).nativeDecimals);
    if (registered === undefined || reserveBase === undefined) {
      return refused("init.bad_gas_reserve", "refused.badGasReserve", { chain });
    }
    found.push({ chain: registered.ref, reserveBase });
  }
  return ok(found);
}

function assetsOf(listed: readonly string[]): InitStep<readonly AssetRef[]> {
  const parsed = listed.map((text) => assetRefSchema.safeParse(text));
  const wrong = listed.find((_, index) => parsed[index]?.success !== true);
  return wrong === undefined
    ? ok(parsed.flatMap((item) => (item.success ? [item.data] : [])))
    : refused("init.bad_token", "refused.badToken", { token: wrong });
}

function limitsOf(
  config: BinferenceConfig,
  venues: readonly string[],
  lists: {
    readonly gasReserve: readonly GasReserve[];
    readonly allow: readonly AssetRef[];
    readonly deny: readonly AssetRef[];
  },
): LimitsValues {
  const { limits, cards, copy } = config.defaults;
  return {
    perTradeUsdMicros: limits.perTradeUsd,
    rollingDayUsdMicros: limits.rollingDayUsd,
    slippageRegistryBps: limits.slippageBps.registry,
    slippageOtherBps: limits.slippageBps.other,
    priceImpactBps: limits.priceImpactBps,
    taxBps: limits.taxBps,
    liquidityFloorUsdMicros: limits.liquidityFloorUsd,
    minHealthFactorBp: Math.round(limits.minHealthFactor * bpPerOne),
    gasReserve: lists.gasReserve,
    venues,
    allowTokens: lists.allow,
    denyTokens: lists.deny,
    modelBudgetUsdMicros: config.defaults.modelBudgetUsdPerDay,
    cardTradeExpiryS: cards.tradeExpirySec,
    cardOtherExpiryS: cards.otherExpirySec,
    requoteAfterS: cards.requoteAfterSec,
    requoteToleranceBps: cards.requoteToleranceBps,
    orderExpiryDays: config.defaults.orders.expiryDays,
    copyPerBuyUsdMicros: copy.perBuyUsd,
    copyPerLeaderDayUsdMicros: copy.perLeaderDayUsd,
  };
}

/** What the first agent is made from besides the config. */
export interface FirstAgentFacts {
  readonly id: Id<"agt">;
  readonly atMs: number;
  /** The ids of the venues it may use. */
  readonly venues: readonly string[];
}

/**
 * The first agent, as the config's `defaults` make it (config spec, section 1): in paper mode
 * (decision 0019), with the approval mode of `defaults.approvalMode`, manual unless the owner set
 * another, and the default limits with coin amounts in base units. A gas reserve on a chain the
 * registry lacks, or a listed token that is no CAIP-19 asset, stops init.
 */
export function firstAgentDraft(
  config: BinferenceConfig,
  registry: ChainRegistry,
  facts: FirstAgentFacts,
): InitStep<AgentDraft> {
  const gasReserve = gasReserveOf(registry, config.defaults.limits.gasReserve);
  if (!gasReserve.ok) {
    return gasReserve;
  }
  const allow = assetsOf(config.defaults.limits.allowTokens);
  if (!allow.ok) {
    return allow;
  }
  const deny = assetsOf(config.defaults.limits.denyTokens);
  if (!deny.ok) {
    return deny;
  }
  return ok({
    id: facts.id,
    name: firstAgentName,
    mode: "paper",
    locale: config.owner.locale,
    models: {},
    notifications: {},
    atMs: facts.atMs,
    limits: limitsOf(config, facts.venues, {
      gasReserve: gasReserve.value,
      allow: allow.value,
      deny: deny.value,
    }),
    approvalMode: config.defaults.approvalMode,
    bySurface: "cli",
  });
}
