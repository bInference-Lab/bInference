import type { AssetRef, ChainRegistry, RegisteredChain } from "@binference/chain";
import type { Bps } from "@binference/core";
import type { LimitsValues } from "../agents/limits-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { tradeSlippageBps } from "../money-path/swap-trade.js";

/** The slippage a new auto order or webhook rule asks of each fill, and what its fills trade. */
export interface AskedSlippage {
  readonly token: AssetRef;
  /** What a buy spends; absent: the chain's coin, which a sale receives. */
  readonly spend?: AssetRef;
  /** Absent: each fill takes the agent's slippage limit. */
  readonly maxSlippageBps?: Bps;
  /** A copy order trades whatever its leader trades, so only a fill knows its pair. */
  readonly isCopy: boolean;
}

/** What a request's slippage is judged by: the agent's limits in effect and the token's chain. */
export interface SlippageContext {
  readonly limits: LimitsValues;
  readonly chain: RegisteredChain;
  readonly chains: ChainRegistry;
}

// The most slippage a fill may ask: the agent's limit for the pair its fills trade, as the fill's
// policy reads it; for a copy order, the larger of the two, as its pair waits for the leader.
function mostSlippageBps(asked: AskedSlippage, context: SlippageContext): Bps {
  const { limits, chain, chains } = context;
  if (asked.isCopy) {
    const { slippageRegistryBps: registry, slippageOtherBps: other } = limits;
    return registry > other ? registry : other;
  }
  return tradeSlippageBps(
    { pair: [asked.token, asked.spend ?? nativeAssetOf(chain)] },
    limits,
    chains,
  );
}

/**
 * Why a new auto order or webhook rule is refused for its slippage, before any card (decision
 * 0362): it asks each fill for more than the agent's slippage limit, which the policy would refuse
 * at every fill as `slippage`. `undefined` for one that names none or asks at most the limit. A
 * limit tightened later still skips each fill.
 */
export function slippageRefusal(
  asked: AskedSlippage,
  context: SlippageContext,
): "order.slippage_limit" | undefined {
  const { maxSlippageBps } = asked;
  return maxSlippageBps !== undefined && maxSlippageBps > mostSlippageBps(asked, context)
    ? "order.slippage_limit"
    : undefined;
}
