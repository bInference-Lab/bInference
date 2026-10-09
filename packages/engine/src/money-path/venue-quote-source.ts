import type { ChainRegistry, PriceSource, Signer } from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { QuoteSource, Simulator, WalletFactsSource } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
import { chooseRoute } from "./choose-route.js";
import { quoteVenues } from "./quote-venues.js";
import { nativeAssetOf, swapChainOf } from "./resolve-proposal.js";
import { swapTradeOf } from "./swap-trade.js";

/** What intents are quoted again with. */
export interface VenueQuoteSourceOptions {
  readonly stored: StoredIntents;
  readonly custody: Signer;
  readonly wallets: WalletFactsSource;
  readonly host: VenueHost;
  readonly simulator: Simulator;
  readonly prices: PriceSource;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/**
 * Creates the {@link QuoteSource} the confirmations ask when the owner taps a card whose quote is
 * old: it resolves the stored request again, with the agent's limits as they are now, asks every
 * venue the agent allows and picks the route as the money path does, by simulation, through the
 * venue host, which checks every step it builds. An intent the money path cannot route again, an
 * unknown one included, is `no_route`; a wallet the custodian no longer holds is `venue_down`, so
 * the card stays open and the owner can cancel it.
 */
export function createVenueQuoteSource(options: VenueQuoteSourceOptions): QuoteSource {
  return {
    async requote(intent, { signal }): Promise<Result<BuiltQuote, QuoteFailure>> {
      const snapshot = await options.stored.snapshot(intent, { signal });
      const request =
        snapshot === undefined ? undefined : requestDocument.decode(snapshot.record.request);
      const chain = request === undefined ? undefined : swapChainOf(request, options.chains);
      if (snapshot === undefined || request === undefined || chain === undefined) {
        return err("no_route");
      }
      const { record } = snapshot;
      const account = await options.custody.account(record.walletId, chain.ref, { signal });
      if (!account.ok) {
        return err("venue_down");
      }
      const { limits } = snapshot.settings;
      const swap = swapTradeOf(request, { limits, account: account.value, chains: options.chains });
      if (!swap.ok) {
        return swap;
      }
      const query = {
        agent: record.agentId,
        wallet: record.walletId,
        account: account.value,
        isPaper: record.isPaper,
      };
      const facts = await options.wallets.facts(query, { signal });
      const { host, clock } = options;
      const quotes = await quoteVenues(swap.value, { host, clock, signal });
      const chosen = await chooseRoute(quotes, {
        swap: swap.value,
        intent,
        host,
        simulator: options.simulator,
        prices: options.prices,
        nativeAsset: nativeAssetOf(chain),
        feePerGasBase: facts.feePerGasNativeBase,
        signal,
      });
      return chosen.ok ? ok(chosen.value.planned.built) : chosen;
    },
  };
}
