import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  type BridgeQuote,
  type BridgeQuoteRequest,
  bridgeQuoteSchema,
  declaredAddress,
  type NoBridgeRoute,
  type RegisteredChain,
} from "@binference/chain";
import { type Bps, bpsPerWhole, type Clock, err, ok, type Result } from "@binference/core";
import type { CeilingEditor } from "../install/ports.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { callVenue, ownCopy } from "../venues/call-venue.js";
import type { BridgeCandidate } from "./bridge-routes.js";
import type { ResolvedBridge } from "./resolve-bridge.js";
import { swapRateOf } from "./swap-rate.js";

/** What a bridge's quotes run on. */
export interface BridgeQuoteParts {
  readonly ceilings: Pick<CeilingEditor, "readStored">;
  readonly clock: Clock;
}

/**
 * The route a bridge takes: its candidate, what it asked, the quote it gave, and on a route the
 * bridge fills by a swap, the share the swap's rate keeps, in basis points.
 */
export interface ChosenBridge {
  readonly candidate: BridgeCandidate;
  readonly request: BridgeQuoteRequest;
  readonly quote: BridgeQuote;
  readonly swapRateBps?: Bps;
}

// Each venue answers within this, or counts as down (decision 0319).
const quoteTimeoutMs = 3_000;
// Least outputs compare at this many decimals, past any token's.
const compareDecimals = 36;

const noRouteReasons: Readonly<Record<NoBridgeRoute, QuoteFailure>> = {
  no_route: "bridge_no_route",
  amount_too_low: "amount_too_low",
  amount_too_high: "amount_too_high",
  low_liquidity: "bridge_liquidity",
};

/** The bridge's declared contracts on the chain, by name, as the registry lists them. */
export function bridgeContractsOn(
  candidate: BridgeCandidate,
  chain: RegisteredChain,
): Readonly<Record<string, AccountRef>> {
  const { bridge } = candidate.hosted;
  const names = bridge.contracts
    .filter((item) => item.chain === chain.ref)
    .flatMap((item) => item.names);
  return Object.fromEntries(
    names.flatMap((name) => {
      const address = declaredAddress(bridge, chain, name);
      return address.ok ? [[name, accountRefSchema.parse(`${chain.ref}:${address.value}`)]] : [];
    }),
  );
}

// The tokens of the wallet's chain a 24-hour approval cap of its ceiling names (decision 0305).
function cappedAssetsOf(parts: BridgeQuoteParts, bridge: ResolvedBridge): readonly AssetRef[] {
  const policy = bridge.walletRecord?.ceiling.policy;
  const read = policy === undefined ? undefined : parts.ceilings.readStored(policy);
  const native = nativeAssetOf(bridge.chain);
  return (read?.dayCaps ?? []).map((cap) => cap.asset).filter((asset) => asset !== native);
}

function requestOf(
  parts: BridgeQuoteParts,
  bridge: ResolvedBridge,
  candidate: BridgeCandidate,
): BridgeQuoteRequest {
  return {
    wallet: bridge.account,
    amountIn: bridge.amount,
    recipient: bridge.payee.account,
    deliveredAsset: candidate.route.arrives,
    cappedAssets: cappedAssetsOf(parts, bridge),
    contracts: bridgeContractsOn(candidate, bridge.chain),
  };
}

// The least a route may pay at the input's own price, less the agent's slippage limit for registry
// tokens, at the delivered token's decimals: a route moves a dollar to a dollar or ETH to ETH.
function floorOf(bridge: ResolvedBridge, candidate: BridgeCandidate): bigint {
  const { leaves, arrives } = candidate.route.decimals;
  const scaled =
    arrives >= leaves
      ? bridge.amount.base * 10n ** BigInt(arrives - leaves)
      : bridge.amount.base / 10n ** BigInt(leaves - arrives);
  const keptBps = BigInt(bpsPerWhole - bridge.settings.limits.slippageRegistryBps);
  return (scaled * keptBps) / BigInt(bpsPerWhole);
}

type Quoted = Result<ChosenBridge, QuoteFailure>;

async function quoteOne(
  parts: BridgeQuoteParts,
  bridge: ResolvedBridge,
  call: { readonly candidate: BridgeCandidate; readonly signal: AbortSignal },
): Promise<Quoted> {
  const { candidate, signal } = call;
  const request = requestOf(parts, bridge, candidate);
  const timing = { clock: parts.clock, signal, timeoutMs: quoteTimeoutMs };
  const answered = await callVenue(
    async (inner) => candidate.hosted.bridge.quote(request, { signal: inner }),
    timing,
  );
  if (!answered.ok) {
    return answered;
  }
  if (!answered.value.ok) {
    return err(noRouteReasons[answered.value.error]);
  }
  const quote = ownCopy(bridgeQuoteSchema, answered.value.value);
  const isAsked =
    quote !== undefined &&
    quote.minOut.asset === candidate.route.arrives &&
    quote.fees.every((fee) => fee.amount.asset === bridge.amount.asset) &&
    quote.expiresAtMs > parts.clock.now();
  return isAsked ? judged(bridge, { candidate, request, quote }) : err("venue_down");
}

// A quote the route's own swap cap or the agent's slippage limit refuses, else the route: on a
// route the bridge fills by a swap, the swap's rate is worked out here from the quote and held to
// the route's cap before the floor (decision 0323).
function judged(bridge: ResolvedBridge, chosen: ChosenBridge): Quoted {
  const { candidate, quote } = chosen;
  const cap = candidate.route.swapCapBps;
  const swapRateBps =
    cap === undefined
      ? undefined
      : swapRateOf({ ...quote, amount: bridge.amount, decimals: candidate.route.decimals });
  if (cap !== undefined && swapRateBps !== undefined && swapRateBps > cap) {
    return err("swap_rate");
  }
  if (quote.minOut.base < floorOf(bridge, candidate)) {
    return err("price_impact");
  }
  return ok(swapRateBps === undefined ? chosen : { ...chosen, swapRateBps });
}

function weightOf(chosen: ChosenBridge): bigint {
  return (
    chosen.quote.minOut.base *
    10n ** BigInt(compareDecimals - chosen.candidate.route.decimals.arrives)
  );
}

// Which reason wins when routes refused for different ones: a route whose swap kept more than its
// cap, one that answered below the floor, then the route's own limits, then a venue that did not
// answer, before no route at all.
const reasonOrder: readonly QuoteFailure[] = [
  "swap_rate",
  "price_impact",
  "amount_too_low",
  "amount_too_high",
  "bridge_liquidity",
  "venue_down",
];

// The reason the bridge ends with when no route answered: the one every route gave, else the first
// of `reasonOrder` any route gave, else no route.
function reasonOf(refusals: readonly QuoteFailure[]): QuoteFailure {
  const [first] = refusals;
  if (first !== undefined && refusals.every((reason) => reason === first)) {
    return first;
  }
  return reasonOrder.find((reason) => refusals.includes(reason)) ?? "bridge_no_route";
}

/**
 * Quotes every route the bridge's wallet may take at once, each venue within 3 seconds, and takes
 * the best least output at the delivered token's decimals (decision 0319). On a route the bridge
 * fills by a swap, a quote whose swap rate keeps more than the route's cap is not taken
 * (`swap_rate`, decision 0323). A quote whose least
 * output is below the amount sent less the agent's slippage limit is not taken (`price_impact`); a
 * venue that throws, runs out of time or answers a quote for another token, one with a fee in
 * another asset than the one sent, or one already expired is `venue_down`; a route a bridge does
 * not serve now gives its typed reason. With no route left, the reason every route gave, else
 * `swap_rate`, `price_impact`, then the amount and liquidity reasons, then `venue_down`, before
 * `bridge_no_route`.
 */
export async function chooseBridge(
  parts: BridgeQuoteParts,
  bridge: ResolvedBridge,
  signal: AbortSignal,
): Promise<Quoted> {
  const quoted = await Promise.all(
    bridge.candidates.map(async (candidate) => quoteOne(parts, bridge, { candidate, signal })),
  );
  const chosen = quoted.flatMap((item) => (item.ok ? [item.value] : []));
  const best = chosen.reduce<ChosenBridge | undefined>(
    (top, item) => (top === undefined || weightOf(item) > weightOf(top) ? item : top),
    undefined,
  );
  return best === undefined
    ? err(reasonOf(quoted.flatMap((item) => (item.ok ? [] : [item.error]))))
    : ok(best);
}
