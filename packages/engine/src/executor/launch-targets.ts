import type { AccountRef } from "@binference/chain";
import { launchWalletOf } from "../install/launch-wallet.js";
import { quoteDocument, requestDocument } from "../intents/intent-documents.schema.js";
import type { LaunchReadFailure } from "../intents/intent-reason.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { InstallStore } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";

/** What reads the contracts of a launch again before a launch wallet's step signs. */
export interface LaunchTargetParts {
  /** The install's wallets; without them no step reaches a launch contract. */
  readonly stores?: { readonly install: Pick<InstallStore, "read"> };
  /** The launchpads' curve reads; without them no step reaches a launch contract. */
  readonly curves?: Pick<VenueHost, "curves">;
}

/**
 * What the launch read gave for an intent's steps: `none` for an intent that runs on no launch's
 * own contracts, the contracts read, or why they could not be (decision 0218): `launch_unread`
 * when the launchpad's read failed, `launch_moved` when the launch no longer names the curve its
 * quote named, as after a graduation.
 */
export type LaunchTargets =
  | { readonly kind: "none" }
  | { readonly kind: "read"; readonly launch: readonly AccountRef[] }
  | { readonly kind: "failed"; readonly reason: LaunchReadFailure };

const none: LaunchTargets = { kind: "none" };

// The token a buy or a sale trades, and the launchpad whose curve its quote names; none for a
// trade in the pools or any other request.
function curveTradeOf(record: IntentRecord) {
  const request = requestDocument.decode(record.request);
  const isTrade = request.kind === "buy" || request.kind === "sell";
  const quote =
    !isTrade || record.quote === undefined ? undefined : quoteDocument.decode(record.quote);
  const place = quote?.place;
  return isTrade && place?.kind === "curve"
    ? { token: request.token, launchpad: place.launchpad }
    : undefined;
}

/**
 * The contracts of the launch a launch wallet's buy or sale runs on, read again from the
 * launchpad its quote names (decision 0217): what the signer lets the steps call and approve
 * besides the registry's set. `none` for another wallet, for a trade in the pools and for a
 * launch with no contracts of its own; a read that fails, or a launchpad that no longer holds the
 * token on its curve, is the reason the intent's next signature cannot be made (decision 0218).
 */
export async function launchTargetsOf(
  record: IntentRecord,
  parts: LaunchTargetParts,
  signal: AbortSignal,
): Promise<LaunchTargets> {
  const { curves, stores } = parts;
  const trade = curveTradeOf(record);
  if (curves === undefined || stores === undefined || trade === undefined) {
    return none;
  }
  const launch = await launchWalletOf(stores.install, record.agentId, { signal });
  if (launch?.id !== record.walletId) {
    return none;
  }
  const claims = await curves.curves(trade.token, { signal });
  if (!claims.ok) {
    return { kind: "failed", reason: "launch_unread" };
  }
  const claim = claims.value.find((item) => item.launchpad === trade.launchpad);
  if (claim === undefined) {
    return { kind: "failed", reason: "launch_moved" };
  }
  const contracts = Object.values(claim.launch ?? {});
  return contracts.length === 0 ? none : { kind: "read", launch: contracts };
}
