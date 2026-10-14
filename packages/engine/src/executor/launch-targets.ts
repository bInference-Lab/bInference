import type { AccountRef } from "@binference/chain";
import { launchWalletOf } from "../install/launch-wallet.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument, requestDocument } from "../intents/intent-documents.schema.js";
import type { InstallStore } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";

/** What reads the contracts of a launch again before a launch wallet's step signs. */
export interface LaunchTargetParts {
  /** The install's wallets; without them no step reaches a launch contract. */
  readonly stores?: { readonly install: Pick<InstallStore, "read"> };
  /** The launchpads' curve reads; without them no step reaches a launch contract. */
  readonly curves?: Pick<VenueHost, "curves">;
}

// The token a buy or a sale trades, and the launchpad whose curve its quote names; none for a
// trade in the pools or any other request.
function curveTradeOf(snapshot: IntentSnapshot) {
  const { record } = snapshot;
  const request = requestDocument.decode(record.request);
  const quote = record.quote === undefined ? undefined : quoteDocument.decode(record.quote);
  const place = quote?.place;
  const isTrade = request.kind === "buy" || request.kind === "sell";
  return isTrade && place?.kind === "curve"
    ? { token: request.token, launchpad: place.launchpad }
    : undefined;
}

/**
 * The contracts of the launch a launch wallet's buy or sale runs on, read again from the
 * launchpad its quote names right before the queue signs (decision 0217): what the signer lets
 * the steps call and approve besides the registry's set. None for another wallet, for a trade in
 * the pools, or when the launchpad's read fails or no longer names the launch, so such a step
 * reaches no launch contract.
 */
export async function launchTargetsOf(
  snapshot: IntentSnapshot,
  parts: LaunchTargetParts,
  signal: AbortSignal,
): Promise<readonly AccountRef[]> {
  const { curves, stores } = parts;
  const trade = curveTradeOf(snapshot);
  if (curves === undefined || stores === undefined || trade === undefined) {
    return [];
  }
  const { record } = snapshot;
  const launch = await launchWalletOf(stores.install, record.agentId, { signal });
  if (launch?.id !== record.walletId) {
    return [];
  }
  const claims = await curves.curves(trade.token, { signal });
  const claim = claims.ok
    ? claims.value.find((item) => item.launchpad === trade.launchpad)
    : undefined;
  return Object.values(claim?.launch ?? {});
}
