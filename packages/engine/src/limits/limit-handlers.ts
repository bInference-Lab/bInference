import type { ChainRef } from "@binference/chain";
import { ok } from "@binference/core";
import type { LimitsView } from "@binference/protocol";
import type { LimitsRecord } from "../agents/limits-record.js";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AgentStore } from "../ports.js";

/** The handler that answers an agent's limits (protocol spec, section 7.6). */
export interface LimitHandlers {
  readonly "limit/get": EngineHandler<"limit/get">;
}

/** An agent's limits as the protocol shows them. */
function viewOf(limits: LimitsRecord): LimitsView {
  const gasReserve: Readonly<Record<ChainRef, bigint>> = Object.fromEntries(
    limits.gasReserve.map(({ chain, reserveBase }) => [chain, reserveBase]),
  );
  return {
    agent: limits.agentId,
    perTradeUsdMicros: limits.perTradeUsdMicros,
    rollingDayUsdMicros: limits.rollingDayUsdMicros,
    slippageRegistryBps: limits.slippageRegistryBps,
    slippageOtherBps: limits.slippageOtherBps,
    priceImpactBps: limits.priceImpactBps,
    taxBps: limits.taxBps,
    liquidityFloorUsdMicros: limits.liquidityFloorUsdMicros,
    minHealthFactorBps: limits.minHealthFactorBp,
    gasReserve,
    venues: limits.venues,
    allowTokens: limits.allowTokens,
    denyTokens: limits.denyTokens,
    modelBudgetUsdMicros: limits.modelBudgetUsdMicros,
    cardTradeExpirySeconds: limits.cardTradeExpiryS,
    cardOtherExpirySeconds: limits.cardOtherExpiryS,
    requoteAfterSeconds: limits.requoteAfterS,
    requoteToleranceBps: limits.requoteToleranceBps,
    orderExpiryDays: limits.orderExpiryDays,
    copyPerBuyUsdMicros: limits.copyPerBuyUsdMicros,
    copyPerLeaderDayUsdMicros: limits.copyPerLeaderDayUsdMicros,
    changedAt: limits.changedAtMs,
  };
}

/**
 * Creates the limits handler. `limit/get` answers an agent's limits as the policy holds every
 * intent to them: the caps in micro-dollars, the gas reserve per chain in base units of its
 * native coin, rates in basis points.
 */
export function createLimitHandlers(options: { readonly agents: AgentStore }): LimitHandlers {
  return {
    async "limit/get"({ args, signal }) {
      const found = await activeAgent(options.agents, args.agent, { signal });
      return found.ok ? ok(viewOf(found.value.limits)) : found;
    },
  };
}
