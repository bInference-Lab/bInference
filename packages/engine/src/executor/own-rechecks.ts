import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentKind } from "../intents/intent-kind.js";
import { type BridgeRecheckParts, recheckBridge } from "./bridge-queue-check.js";
import { type LaunchRecheckParts, recheckLaunch } from "./launch-queue-check.js";
import { recheckStake, type StakeRecheckParts } from "./stake-queue-check.js";
import { recheckTransfer } from "./transfer-queue-check.js";

/** What the policy run again on an intent of a kind with a path of its own answers. */
export interface OwnRecheck {
  readonly hasPassed: boolean;
  readonly networkFeeCapNativeBase?: bigint;
}

/** What every kind with a path of its own reads as the queue checks it again. */
export type OwnRecheckParts = LaunchRecheckParts & BridgeRecheckParts & StakeRecheckParts;

type Recheck = (
  snapshot: IntentSnapshot,
  parts: OwnRecheckParts,
  signal: AbortSignal,
) => Promise<OwnRecheck>;

// The kinds whose request and quote are their own, each with the policy run again on its terms.
const ownRechecks: Partial<Readonly<Record<IntentKind, Recheck>>> = {
  launchToken: recheckLaunch,
  send: recheckTransfer,
  revokeApproval: recheckTransfer,
  bridge: recheckBridge,
  stake: recheckStake,
};

/**
 * The policy run again on a confirmed intent of a kind with a path of its own as the wallet queue
 * takes it (spec 6, `queue_took`): a token launch, a send or an approval revoke, a bridge or a
 * staking move, each on the terms its card confirmed. `undefined` for a trade, which the queue
 * checks on its route.
 */
export async function recheckOwnKind(
  snapshot: IntentSnapshot,
  parts: OwnRecheckParts,
  signal: AbortSignal,
): Promise<OwnRecheck | undefined> {
  const recheck = ownRechecks[snapshot.record.kind];
  return recheck === undefined ? undefined : recheck(snapshot, parts, signal);
}
