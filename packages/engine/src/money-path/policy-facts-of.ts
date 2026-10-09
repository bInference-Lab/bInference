import { type AssetRef, type ChainRef } from "@binference/chain";
import type { AgentSettings } from "../agents/agent-record.js";
import type { LimitsValues } from "../agents/limits-record.js";
import type { PolicyFacts, PolicyLimits } from "../policy/policy-rules.js";
import { sendLevelAt } from "../policy/send-level-change.js";
import type { WalletFacts } from "./wallet-facts.js";

/** What the policy's facts are read from for one intent. */
export interface PolicyFactsInput {
  readonly settings: AgentSettings;
  readonly wallet: WalletFacts;
  /** The intent's chain and its native coin. */
  readonly chain: ChainRef;
  readonly nativeAsset: AssetRef;
  /** When the policy runs: a pending send level counts from its time on. */
  readonly nowMs: number;
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
 * The facts the policy checks an intent with. The send level is the agent's level in effect now:
 * a looser level still waiting its 24 hours does not count. The address book holds the agent's
 * live entries on every chain, since a bridge pays one on another chain; an entry counts as saved
 * once the owner key put it in the ceiling. The rescue address is left out, so no send may pay it:
 * the money path routes no send or rescue yet, and the step that routes one reads the install's
 * address in effect through `rescueAt`.
 */
export function policyFactsOf(input: PolicyFactsInput): PolicyFacts {
  const { settings, wallet } = input;
  return {
    isFrozen: settings.agent.frozenAtMs !== undefined,
    limits: policyLimitsOf(settings.limits, input.chain),
    sendLevel: sendLevelAt(settings.sendLevel, input.nowMs).level,
    addressBook: settings.addressBook.map((entry) => ({
      account: entry.account,
      isSaved: entry.inCeilingAtMs !== undefined,
      usableAtMs: entry.usableAtMs,
    })),
    nativeAsset: input.nativeAsset,
    nativeBalanceBase: wallet.nativeBalanceBase,
    ceilingPerTxNativeBase: wallet.ceilingPerTxNativeBase,
    recentOutflows: wallet.recentOutflows,
  };
}
