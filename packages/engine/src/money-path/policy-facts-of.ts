import { type AssetRef, type ChainRef } from "@binference/chain";
import type { AgentSettings } from "../agents/agent-record.js";
import type { LimitsValues } from "../agents/limits-record.js";
import type { PolicyFacts, PolicyLimits } from "../policy/policy-rules.js";
import type { WalletFacts } from "./wallet-facts.js";

/** What the policy's facts are read from for one intent. */
export interface PolicyFactsInput {
  readonly settings: AgentSettings;
  readonly wallet: WalletFacts;
  /** The intent's chain and its native coin. */
  readonly chain: ChainRef;
  readonly nativeAsset: AssetRef;
}

/** The agent's limits as the policy reads them on one chain; a chain without a reserve keeps none. */
export function policyLimitsOf(limits: LimitsValues, chain: ChainRef): PolicyLimits {
  const reserve = limits.gasReserve.find((entry) => entry.chain === chain);
  return {
    perTradeCapUsdMicros: limits.perTradeUsdMicros,
    rollingDayCapUsdMicros: limits.rollingDayUsdMicros,
    maxSlippageBps: { registry: limits.slippageRegistryBps, other: limits.slippageOtherBps },
    maxTaxBps: limits.taxBps,
    gasReserveBase: reserve?.reserveBase ?? 0n,
    venues: limits.venues,
    allowTokens: limits.allowTokens,
    denyTokens: limits.denyTokens,
  };
}

/**
 * The facts the policy checks an intent with. The send level is 3 (Locked) and the address book
 * and rescue address are empty until their own store ports exist, so every send is refused: the
 * money path fails closed on what it cannot read.
 */
export function policyFactsOf(input: PolicyFactsInput): PolicyFacts {
  const { settings, wallet } = input;
  return {
    isFrozen: settings.agent.frozenAtMs !== undefined,
    limits: policyLimitsOf(settings.limits, input.chain),
    sendLevel: 3,
    addressBook: [],
    nativeAsset: input.nativeAsset,
    nativeBalanceBase: wallet.nativeBalanceBase,
    ceilingPerTxNativeBase: wallet.ceilingPerTxNativeBase,
    recentOutflows: wallet.recentOutflows,
  };
}
