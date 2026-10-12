import {
  type AccountRef,
  type AssetRef,
  assetRefParts,
  canonicalAsset,
  type ChainRegistry,
  type RegisteredChain,
} from "@binference/chain";
import { type Bps, err, ok, type Result } from "@binference/core";
import type {
  BuyRequest,
  IntentRequest,
  SellRequest,
  SwapRequest,
  TokenAmount,
  TradePlace,
} from "@binference/protocol";
import type { LimitsValues } from "../agents/limits-record.js";
import type { PolicySubject, RequestedSlippage } from "../policy/policy-rules.js";
import type { VenueTrade } from "../venues/venue-host.js";
import { assetInfoOf } from "./asset-infos.js";

/**
 * A `swap`, `buy` or `sell` request read for the money path, before its place and its amount are
 * known. Every asset is in its family's canonical form, so the policy's token lists judge every
 * spelling of a token alike.
 */
export interface TradeAsk {
  readonly kind: "swap" | "buy" | "sell";
  /** What leaves the wallet. */
  readonly assetIn: AssetRef;
  /** How much of it: base units, or a share of what the wallet holds when the quote is built. */
  readonly amount: TokenAmount;
  /** What enters the wallet; absent for a sale that leaves it to its place. */
  readonly assetOut?: AssetRef;
  /** The token whose place picks the venues: a buy's or a sale's. A swap asks every venue. */
  readonly placed?: AssetRef;
  /** The slippage the request asks for; absent when it leaves it to the agent's maximum. */
  readonly maxSlippageBps?: Bps;
}

/** A trade request resolved for one wallet: the trade the venue host plans, and its slippage. */
export interface SwapTrade {
  /** The trade on the first venue to ask. */
  readonly trade: VenueTrade;
  /** Every venue to ask, in the agent's order; the best quote asks each one. */
  readonly venues: readonly string[];
  /** The slippage the request asked for; absent when it leaves it to the agent's maximum. */
  readonly slippage?: RequestedSlippage;
  /** Where a buy or a sell trades; a swap has no place. */
  readonly place?: TradePlace;
}

/** What a trade is resolved against: the agent's limits, the wallet's account and the chains. */
export interface SwapContext {
  readonly limits: LimitsValues;
  /** The wallet's account on the trade's chain. */
  readonly account: AccountRef;
  readonly chains: ChainRegistry;
}

/** The terms a trade settles on: its amount, what it buys, its place and the venues to ask. */
export interface TradeTerms {
  readonly amountInBase: bigint;
  readonly assetOut: AssetRef;
  readonly venues: readonly string[];
  readonly place?: TradePlace;
}

// The registry writes its tokens in their family's canonical form, as the lookup must.
function isRegistryPair(chains: ChainRegistry, assets: readonly AssetRef[]): boolean {
  return assets.every((asset) => {
    const canonical = canonicalAsset(chains, asset);
    return canonical.ok && assetInfoOf(chains, canonical.value) !== undefined;
  });
}

/**
 * The most slippage a trade allows: what its request asks, or else the agent's maximum for a pair
 * of registry tokens or for any other pair.
 */
export function tradeSlippageBps(
  trade: { readonly pair: readonly AssetRef[]; readonly asked?: Bps },
  limits: LimitsValues,
  chains: ChainRegistry,
): Bps {
  const { slippageRegistryBps, slippageOtherBps } = limits;
  const isRegistry = isRegistryPair(chains, trade.pair);
  return trade.asked ?? (isRegistry ? slippageRegistryBps : slippageOtherBps);
}

// The asset whose chain a trade runs on: what a swap sells, or the token a buy or a sell names.
function tradedAssetOf(request: IntentRequest): AssetRef | undefined {
  if (request.kind === "swap") {
    return request.from;
  }
  return request.kind === "buy" || request.kind === "sell" ? request.token : undefined;
}

/**
 * The chain a request trades on: that of the asset a swap sells, or of the token a buy or a sell
 * names. The money path routes trades only, so any other kind, or a chain the registry does not
 * hold, is `undefined`.
 */
export function tradeChainOf(
  request: IntentRequest,
  chains: ChainRegistry,
): RegisteredChain | undefined {
  const asset = tradedAssetOf(request);
  const chain = asset === undefined ? undefined : chains.get(assetRefParts(asset).chain);
  return chain?.ok === true ? chain.value : undefined;
}

// Each asset in its family's canonical form, or none when one has none.
function canonicalAll(
  chains: ChainRegistry,
  assets: readonly AssetRef[],
): readonly AssetRef[] | undefined {
  const canonical = assets.map((asset) => canonicalAsset(chains, asset));
  return canonical.every((asset) => asset.ok) ? canonical.map((asset) => asset.value) : undefined;
}

// A buy spends the chain's coin or a token the registry lists, as spec 1 asks of its `spend`.
function isSpendable(chains: ChainRegistry, asset: AssetRef): boolean {
  return assetInfoOf(chains, asset) !== undefined;
}

function withSlippage<T extends object>(ask: T, asked: Bps | undefined): T {
  return asked === undefined ? ask : { ...ask, maxSlippageBps: asked };
}

type AskResult = Result<TradeAsk, "no_route" | "protocol.bad_args">;

function swapAskOf(request: SwapRequest, chains: ChainRegistry): AskResult {
  const [from, to] = canonicalAll(chains, [request.from, request.to]) ?? [];
  if (from === undefined || to === undefined) {
    return err("protocol.bad_args");
  }
  const ask = { kind: "swap", assetIn: from, amount: request.amount, assetOut: to } as const;
  return ok(withSlippage(ask, request.maxSlippageBps));
}

function buyAskOf(request: BuyRequest, chains: ChainRegistry): AskResult {
  const [spend, token] = canonicalAll(chains, [request.spend.asset, request.token]) ?? [];
  if (spend === undefined || token === undefined || !isSpendable(chains, spend)) {
    return err("protocol.bad_args");
  }
  const amount = { base: request.spend.base };
  const ask = { kind: "buy", assetIn: spend, amount, assetOut: token, placed: token } as const;
  return ok(withSlippage(ask, request.maxSlippageBps));
}

function sellAskOf(request: SellRequest, chains: ChainRegistry): AskResult {
  const { receive } = request;
  const [token, received] =
    canonicalAll(chains, receive === undefined ? [request.token] : [request.token, receive]) ?? [];
  if (token === undefined || (receive !== undefined && received === undefined)) {
    return err("protocol.bad_args");
  }
  const sale = { kind: "sell", assetIn: token, amount: request.amount, placed: token } as const;
  const ask = received === undefined ? sale : { ...sale, assetOut: received };
  return ok(withSlippage(ask, request.maxSlippageBps));
}

/**
 * Reads a `swap`, `buy` or `sell` request for the money path. Every asset takes its family's
 * canonical form; an asset that has none, or a buy that spends anything but the chain's coin or a
 * registry token, is `protocol.bad_args`. Another kind, or an agent with no venue, is `no_route`.
 */
export function tradeAskOf(
  request: IntentRequest,
  context: Pick<SwapContext, "limits" | "chains">,
): AskResult {
  const { chains } = context;
  if (context.limits.venues.length === 0) {
    return err("no_route");
  }
  if (request.kind === "swap") {
    return swapAskOf(request, chains);
  }
  if (request.kind === "buy") {
    return buyAskOf(request, chains);
  }
  return request.kind === "sell" ? sellAskOf(request, chains) : err("no_route");
}

/**
 * The trade the venue host plans for an ask on settled terms: the wallet's account pays and
 * receives, on the first venue to ask and then the others in order, with the slippage the request
 * asks or the agent's maximum for the pair. With no venue to ask, the trade names the agent's first
 * venue, so the policy can still judge it; the money path asks none.
 */
export function swapTradeOf(ask: TradeAsk, terms: TradeTerms, context: SwapContext): SwapTrade {
  const { limits, chains } = context;
  const pair = [ask.assetIn, terms.assetOut];
  const asked = ask.maxSlippageBps;
  const trade: VenueTrade = {
    venue: terms.venues[0] ?? limits.venues[0] ?? "",
    wallet: context.account,
    amountIn: { asset: ask.assetIn, base: terms.amountInBase },
    assetOut: terms.assetOut,
    maxSlippageBps: tradeSlippageBps(
      asked === undefined ? { pair } : { pair, asked },
      limits,
      chains,
    ),
  };
  const swap: SwapTrade = { trade, venues: terms.venues };
  const withPlace = terms.place === undefined ? swap : { ...swap, place: terms.place };
  return asked === undefined
    ? withPlace
    : { ...withPlace, slippage: { bps: asked, isRegistryPair: isRegistryPair(chains, pair) } };
}

/**
 * The policy's subject for a resolved trade: what leaves the wallet, and what enters it. A trade on
 * a launchpad's curve names the launchpad, so the policy refuses one the agent may not use.
 */
export function swapSubjectOf(
  swap: SwapTrade,
  intent: Pick<PolicySubject, "kind" | "isPaper" | "hasOutsideContent">,
): PolicySubject {
  const { trade, slippage, place } = swap;
  return {
    ...intent,
    outflows: [trade.amountIn],
    inflowAssets: [trade.assetOut],
    ...(slippage === undefined ? {} : { slippage }),
    ...(place?.kind === "curve" ? { venue: place.launchpad } : {}),
  };
}
