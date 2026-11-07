import type { AssetRef, ChainRegistry, Signer } from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { IntentRequest, ProtocolErrorCode, QuoteView } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { WalletFactsSource } from "../ports.js";
import type { QuoteOutcome, TradeQuote, VenueHost } from "../venues/venue-host.js";
import type { LaunchRouting } from "./launch-routing.js";
import { placeTrade } from "./place-trade.js";
import { buildSwap } from "./plan-swap.js";
import { quoteVenues } from "./quote-venues.js";
import { resolveProposal } from "./resolve-proposal.js";
import type { SwapTrade } from "./swap-trade.js";
import type { Holdings } from "./wallet-facts.js";

/** What a quote is read with: what a proposal is resolved and placed with, and the venues. */
export interface QuoteRequestOptions {
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly holdings: Holdings;
  readonly launches?: LaunchRouting;
  readonly host: VenueHost;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

// A refusal that names a venue that did not answer is retryable; every other one has no route.
function quoteErrorOf(failure: QuoteFailure): ProtocolErrorCode {
  return failure === "venue_down" ? "quote.venue_down" : "quote.no_route";
}

function byExpectedOut(a: TradeQuote, b: TradeQuote): number {
  const [low, high] = [a.quote.expectedOut.base, b.quote.expectedOut.base];
  if (low === high) {
    return 0;
  }
  return high > low ? 1 : -1;
}

// The venue quote the agent would take: the best expected output within its maximum price impact,
// as the money path keeps quotes.
function bestQuote(
  quotes: readonly QuoteOutcome[],
  maxPriceImpactBps: number,
): TradeQuote | undefined {
  return quotes
    .flatMap((quote) => (quote.ok ? [quote.value] : []))
    .filter((quoted) => quoted.quote.priceImpactBps <= maxPriceImpactBps)
    .toSorted(byExpectedOut)[0];
}

// No quote to take: every venue that was asked did not answer, or none could quote the trade.
function noQuoteError(quotes: readonly QuoteOutcome[]): ProtocolErrorCode {
  const isDown =
    quotes.length > 0 && quotes.every((quote) => !quote.ok && quote.error === "venue_down");
  return isDown ? "quote.venue_down" : "quote.no_route";
}

/** A request and the settings of the agent it names. */
interface Asked {
  readonly request: IntentRequest;
  readonly settings: AgentSettings;
}

/** The venue quote a request would take, before anything is built. */
export interface BestTrade {
  readonly swap: SwapTrade;
  readonly quoted: TradeQuote;
  /** The native coin of the trade's chain, which pays its gas. */
  readonly nativeAsset: AssetRef;
}

/**
 * The venue quote a swap, buy or sell request would take, as its proposal would: the request is
 * resolved for the agent's wallet in its mode, placed on its curve or in the pools, and quoted by
 * every venue its place allows; the quote with the best expected output within the agent's maximum
 * price impact wins. Nothing is built, simulated or stored. A venue that does not answer is
 * `quote.venue_down`, a trade no venue can quote `quote.no_route`.
 */
export async function quoteBestTrade(
  options: QuoteRequestOptions,
  asked: Asked,
  signal: AbortSignal,
): Promise<Result<BestTrade, ProtocolErrorCode>> {
  const { request, settings } = asked;
  const resolved = await resolveProposal(options, { request, settings, signal });
  if (!resolved.ok) {
    return resolved;
  }
  const { ask, account, nativeAsset, wallet, launchWallet } = resolved.value;
  const { host, chains, clock, holdings } = options;
  const isPaper = settings.agent.mode === "paper";
  const placing = { limits: settings.limits, account, chains, host, nativeAsset, holdings };
  const placed = await placeTrade(ask, {
    ...placing,
    ...(launchWallet === undefined ? {} : { launchWallet }),
    wallet,
    isPaper,
    signal,
  });
  if (placed.refusal !== undefined) {
    return err(quoteErrorOf(placed.refusal));
  }
  const quotes = await quoteVenues(placed.swap, { host, clock, signal });
  const quoted = bestQuote(quotes, settings.limits.priceImpactBps);
  return quoted === undefined
    ? err(noQuoteError(quotes))
    : ok({ swap: placed.swap, quoted, nativeAsset });
}

/**
 * Quotes a request for `quote/get` (protocol spec, section 7.3) and stores nothing: the quote
 * {@link quoteBestTrade} picks, built and checked by the venue host, never simulated or signed. A
 * build that fails is `quote.venue_down` when the venue did not answer, else `quote.no_route`.
 */
export async function quoteRequest(
  options: QuoteRequestOptions,
  asked: Asked,
  signal: AbortSignal,
): Promise<Result<QuoteView, ProtocolErrorCode>> {
  const best = await quoteBestTrade(options, asked, signal);
  if (!best.ok) {
    return best;
  }
  const { swap, quoted, nativeAsset } = best.value;
  const built = await buildSwap(swap, quoted, { host: options.host, nativeAsset, signal });
  return built.ok ? ok(built.value.built.quote) : err(quoteErrorOf(built.error));
}
