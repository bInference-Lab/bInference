import type { ChainRegistry } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { launchViewSchema } from "@binference/protocol";
import type { AlertFiring } from "../alerts/fire-alerts.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { StoredLaunch } from "./launch-record.js";
import { launchViewOf } from "./launch-view-of.js";

/** Where the launches the feed stored new are told: the pushes, and the launch alerts. */
export interface LaunchTellParts {
  readonly chains: ChainRegistry;
  readonly publish: PublishPush;
  readonly alerts: Pick<AlertFiring, "seeLaunch">;
  /** Told each launch whose alerts could not be fired; the launch stays stored and pushed. */
  readonly onAlertFailed?: (launch: StoredLaunch) => void;
}

/**
 * Tells each launch the feed stored new, one after another in the order given, which is block and
 * log order (decision 0256): `launch/new` on the `launch` topic with its `LaunchView`, then the
 * launch alerts' `seeLaunch` with no liquidity, which the feed does not read. An alert that fails
 * is reported and the next launch is told: the launch is stored, so it is never told again.
 * Rejects with the signal's reason once it aborts.
 */
export async function tellLaunches(
  parts: LaunchTellParts,
  launches: readonly StoredLaunch[],
  call: { readonly signal: AbortSignal },
): Promise<void> {
  await launches.reduce(async (told, launch) => {
    await told;
    call.signal.throwIfAborted();
    const view = launchViewOf(parts.chains, launch);
    const data = jsonValueSchema.parse(launchViewSchema.encode(view));
    parts.publish({ topic: "launch", kind: "launch/new", data });
    try {
      await parts.alerts.seeLaunch({ launch: view, assets: view.assets }, call);
    } catch {
      call.signal.throwIfAborted();
      parts.onAlertFailed?.(launch);
    }
  }, Promise.resolve());
}
