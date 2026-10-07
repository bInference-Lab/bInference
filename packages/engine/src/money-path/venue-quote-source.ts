import type { ChainRegistry, Signer } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { QuoteSource } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
import { planSwap } from "./plan-swap.js";
import { nativeAssetOf, swapChainOf } from "./resolve-proposal.js";
import { swapTradeOf } from "./swap-trade.js";

/** What intents are quoted again with. */
export interface VenueQuoteSourceOptions {
  readonly stored: StoredIntents;
  readonly custody: Signer;
  readonly host: VenueHost;
  readonly chains: ChainRegistry;
}

/**
 * Creates the {@link QuoteSource} the confirmations ask when the owner taps a card whose quote is
 * old: it resolves the stored request again, with the agent's limits as they are now, and plans
 * it through the venue host, which checks every step it builds. An intent the money path cannot
 * route again, an unknown one included, is `no_route`; a wallet the custodian no longer holds is
 * `venue_down`, so the card stays open and the owner can cancel it.
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
      const account = await options.custody.account(snapshot.record.walletId, chain.ref, {
        signal,
      });
      if (!account.ok) {
        return err("venue_down");
      }
      const { limits } = snapshot.settings;
      const swap = swapTradeOf(request, { limits, account: account.value, chains: options.chains });
      if (!swap.ok) {
        return swap;
      }
      const nativeAsset = nativeAssetOf(chain);
      const planned = await planSwap(swap.value, { host: options.host, nativeAsset, signal });
      return planned.ok ? ok(planned.value.built) : planned;
    },
  };
}
