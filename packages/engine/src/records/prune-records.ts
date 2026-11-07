import type { Clock } from "@binference/core";
import type { EngineStores } from "./engine-stores.js";

const dayMs = 86_400_000;

/** How long the alerts webhook rules took are kept (database spec, section 4). */
export const webhookEventsKeptMs: number = 90 * dayMs;

/** How long a handled inbox entry is kept (database spec, section 4). */
export const handledInboxKeptMs: number = 30 * dayMs;

/** How long a removed credential is kept before it is dropped with its value (decision 0388). */
export const removedCredentialsKeptMs: number = 30 * dayMs;

/** The engine's prune of records that outside input grows, which a daily timer runs. */
export interface PruneWork {
  /**
   * Deletes the `webhook_events` rows received more than 90 days ago, the inbox entries handled
   * more than 30 days ago and the credentials removed more than 30 days ago, and answers how many
   * went. An unhandled inbox entry is never deleted.
   */
  readonly pruneRecords: (options: { readonly signal: AbortSignal }) => Promise<number>;
}

/** The engine's {@link PruneWork} over its stores. */
export function pruneWorkOf(options: {
  readonly stores: Pick<EngineStores, "webhookAlerts" | "inbox" | "credentials">;
  readonly clock: Clock;
}): PruneWork {
  const { stores, clock } = options;
  return {
    pruneRecords: async (call) => {
      const nowMs = clock.now();
      const events = await stores.webhookAlerts.prune(nowMs - webhookEventsKeptMs, call);
      const entries = await stores.inbox.prune(nowMs - handledInboxKeptMs, call);
      const credentials = await stores.credentials.purge(nowMs - removedCredentialsKeptMs, call);
      return events + entries + credentials;
    },
  };
}
