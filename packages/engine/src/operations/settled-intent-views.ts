import { cardLineText, createFormatter } from "@binference/i18n";
import type { IntentViewOf } from "../chat/inbox-views.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type { EngineOptions } from "./create-engine.js";
import { intentViewOf } from "./intent-view-of.js";
import { receiptViewReads } from "./receipt-view-reads.js";

/** Where the settle messages' views read the intents and the owner's language from. */
export interface SettledIntentViewsOptions {
  readonly engine: Pick<
    EngineOptions,
    "stores" | "chains" | "destinations" | "host" | "isLocked" | "ownerLocale" | "ownerTimeZone"
  >;
  /** The stored intents, once the engine attached them. */
  readonly late: { readonly stored?: StoredIntents };
}

/**
 * Reads each settled intent for its settle message (decision 0458): its view as `intent/get`
 * gives it, with the receipt its closed card ends with, and that receipt line as the owner's
 * surfaces draw it, in `owner.locale` and `owner.timezone` now. A settled bridge's reason names
 * its destination chain, as every surface's view does.
 */
export function settledIntentViewsOf(options: SettledIntentViewsOptions): IntentViewOf {
  const { stores, chains, destinations, host, isLocked } = options.engine;
  const showings = createCardShowings({ ...stores, chains, destinations, venues: host, isLocked });
  return async (intent, signal) => {
    const snapshot = await options.late.stored?.snapshot(intent, { signal });
    if (snapshot === undefined) {
      return undefined;
    }
    const receipt = await receiptViewReads({ showings }, snapshot, signal);
    const view = intentViewOf(snapshot, chains, { ...receipt, destinations });
    if (view.receipt === undefined) {
      return { intent: view };
    }
    const formatter = createFormatter({
      locale: options.engine.ownerLocale(),
      timeZone: options.engine.ownerTimeZone(),
    });
    return {
      intent: view,
      shownReceipt: cardLineText(view.receipt, { formatter, assets: view.assets }),
    };
  };
}
