import { type AccountRef, type AssetRef, type ChainRegistry } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { IntentRequest } from "@binference/protocol";
import type { LimitsValues } from "../agents/limits-record.js";
import type { PolicySubject, RequestedSlippage } from "../policy/policy-rules.js";
import type { VenueTrade } from "../venues/venue-host.js";
import { assetInfoOf } from "./asset-infos.js";

/** A swap request resolved for one wallet: the trade the venue host plans, and its slippage. */
export interface SwapTrade {
  readonly trade: VenueTrade;
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
 * Resolves a swap of an exact amount into the trade the venue host plans: the wallet's account
 * pays and receives, on the agent's first allowed venue, with the slippage the request asks or
 * the agent's maximum for the pair. A request the money path cannot route yet, such as another
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
  const { slippageRegistryBps, slippageOtherBps } = context.limits;
  const asked = request.maxSlippageBps;
  const trade: VenueTrade = {
    venue,
    wallet: context.account,
    amountIn: { asset: request.from, base: request.amount.base },
    assetOut: request.to,
    maxSlippageBps: asked ?? (isRegistry ? slippageRegistryBps : slippageOtherBps),
  };
  return ok(
    asked === undefined
      ? { trade }
      : { trade, slippage: { bps: asked, isRegistryPair: isRegistry } },
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
