import { type AccountRef, type AssetRef, type ChainRegistry } from "@binference/chain";
import { type Bps, err, ok, type Result } from "@binference/core";
import type { IntentRequest, SwapRequest } from "@binference/protocol";
import type { LimitsValues } from "../agents/limits-record.js";
import type { PolicySubject, RequestedSlippage } from "../policy/policy-rules.js";
import type { VenueTrade } from "../venues/venue-host.js";
import { assetInfoOf } from "./asset-infos.js";

/** A swap request resolved for one wallet: the trade the venue host plans, and its slippage. */
export interface SwapTrade {
  /** The trade on the agent's first allowed venue. */
  readonly trade: VenueTrade;
  /** Every venue the agent allows, in its order; the best quote asks each one. */
  readonly venues: readonly string[];
  /** The slippage the request asked for; absent when it leaves it to the agent's maximum. */
  readonly slippage?: RequestedSlippage;
}

/** What a request is resolved against: the agent's limits, the wallet's account and the chains. */
export interface SwapContext {
  readonly limits: LimitsValues;
  /** The wallet's account on the chain of the asset it sells. */
  readonly account: AccountRef;
  readonly chains: ChainRegistry;
}

function isRegistryPair(chains: ChainRegistry, assets: readonly AssetRef[]): boolean {
  return assets.every((asset) => assetInfoOf(chains, asset) !== undefined);
}

/**
 * The most slippage a swap allows: what the request asks, or else the agent's maximum for a pair
 * of registry tokens or for any other pair.
 */
export function swapSlippageBps(
  request: SwapRequest,
  limits: LimitsValues,
  chains: ChainRegistry,
): Bps {
  const { slippageRegistryBps, slippageOtherBps } = limits;
  const isRegistry = isRegistryPair(chains, [request.from, request.to]);
  return request.maxSlippageBps ?? (isRegistry ? slippageRegistryBps : slippageOtherBps);
}

/**
 * Resolves a swap of an exact amount into the trade the venue host plans: the wallet's account
 * pays and receives, on the agent's first allowed venue and then the others in order, with the
 * slippage the request asks or the agent's maximum for the pair. A request the money path cannot route yet, such as another
 * kind, a share of a balance, or an agent with no venue, is `no_route`.
 */
export function swapTradeOf(
  request: IntentRequest,
  context: SwapContext,
): Result<SwapTrade, "no_route"> {
  const [venue] = context.limits.venues;
  if (request.kind !== "swap" || !("base" in request.amount) || venue === undefined) {
    return err("no_route");
  }
  const isRegistry = isRegistryPair(context.chains, [request.from, request.to]);
  const asked = request.maxSlippageBps;
  const trade: VenueTrade = {
    venue,
    wallet: context.account,
    amountIn: { asset: request.from, base: request.amount.base },
    assetOut: request.to,
    maxSlippageBps: swapSlippageBps(request, context.limits, context.chains),
  };
  const { venues } = context.limits;
  return ok(
    asked === undefined
      ? { trade, venues }
      : { trade, venues, slippage: { bps: asked, isRegistryPair: isRegistry } },
  );
}

/** The policy's subject for a resolved swap: what leaves the wallet, and what enters it. */
export function swapSubjectOf(
  swap: SwapTrade,
  intent: Pick<PolicySubject, "kind" | "isPaper" | "hasOutsideContent">,
): PolicySubject {
  const { trade, slippage } = swap;
  return {
    ...intent,
    outflows: [trade.amountIn],
    inflowAssets: [trade.assetOut],
    ...(slippage === undefined ? {} : { slippage }),
  };
}
