import type { ChainRegistry, PriceSource, RegisteredChain, Signer } from "@binference/chain";
import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { QuoteSource, Simulator, WalletFactsSource } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
import { chooseRoute } from "./choose-route.js";
import { placeTrade } from "./place-trade.js";
import { quoteVenues } from "./quote-venues.js";
import { nativeAssetOf } from "./resolve-proposal.js";
import { type TradeAsk, tradeAskOf, tradeChainOf } from "./swap-trade.js";
import type { Holdings } from "./wallet-facts.js";

/** What intents are quoted again with. */
export interface VenueQuoteSourceOptions {
  readonly stored: StoredIntents;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  /** What a wallet holds of the asset a sale by share sells, in the intent's mode. */
  readonly holdings: Holdings;
  readonly host: VenueHost;
  readonly simulator: Simulator;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/** An intent read again for its re-quote: what it asks, on which chain, for which wallet. */
interface Requoting {
  readonly snapshot: IntentSnapshot;
  readonly ask: TradeAsk;
  readonly chain: RegisteredChain;
}

async function requotingOf(
  options: VenueQuoteSourceOptions,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<Requoting | undefined> {
  const snapshot = await options.stored.snapshot(intent, { signal });
  const request =
    snapshot === undefined ? undefined : requestDocument.decode(snapshot.record.request);
  const chain = request === undefined ? undefined : tradeChainOf(request, options.chains);
  if (snapshot === undefined || request === undefined || chain === undefined) {
    return undefined;
  }
  const ask = tradeAskOf(request, { limits: snapshot.settings.limits, chains: options.chains });
  return ask.ok ? { snapshot, ask: ask.value, chain } : undefined;
}

async function requote(
  options: VenueQuoteSourceOptions,
  { snapshot, ask, chain }: Requoting,
  signal: AbortSignal,
): Promise<Result<BuiltQuote, QuoteFailure>> {
  const { record, settings } = snapshot;
  const account = await options.custody.account(record.walletId, chain.ref, { signal });
  if (!account.ok) {
    return err("venue_down");
  }
  const { limits } = settings;
  const { chains, host, clock, holdings } = options;
  const { walletId: wallet, isPaper } = record;
  const query = { agent: record.agentId, wallet, account: account.value, isPaper };
  const facts = await options.wallets.facts(query, { signal });
  const nativeAsset = nativeAssetOf(chain);
  const placing = { limits, account: account.value, chains, host, nativeAsset, holdings };
  const placed = await placeTrade(ask, { ...placing, wallet, isPaper, signal });
  if (placed.refusal !== undefined) {
    return err(placed.refusal);
  }
  const quotes = await quoteVenues(placed.swap, { host, clock, signal });
  const chosen = await chooseRoute(quotes, {
    swap: placed.swap,
    intent: record.id,
    host,
    simulator: options.simulator,
    prices: options.prices,
    nativeAsset,
    feePerGasBase: facts.feePerGasNativeBase,
    maxPriceImpactBps: limits.priceImpactBps,
    signal,
  });
  return chosen.ok ? ok(chosen.value.planned.built) : chosen;
}

/**
 * Creates the {@link QuoteSource} the confirmations ask when the owner taps a card whose quote is
 * old: it resolves the stored request again, with the agent's limits as they are now, places the
 * trade again as the money path does, so a sale by share sells its share of what the wallet holds
 * now, asks the venues of its place and picks the route by simulation, through the venue host,
 * which checks every step it builds. A quote above the agent's maximum price impact is dropped,
 * and with none left the re-quote is `price_impact`. An intent the money path cannot route again,
 * an unknown one included, is `no_route`. A buy or a sell whose place changed since its card, a
 * token that graduated, is quoted at its new place; the state machine then opens the next card
 * version, since the card named the place. A wallet the custodian no longer holds is
 * `venue_down`. Each failure leaves the card open, and the owner can cancel it.
 */
export function createVenueQuoteSource(options: VenueQuoteSourceOptions): QuoteSource {
  return {
    async requote(intent, { signal }): Promise<Result<BuiltQuote, QuoteFailure>> {
      const requoting = await requotingOf(options, intent, signal);
      return requoting === undefined ? err("no_route") : requote(options, requoting, signal);
    },
  };
}
