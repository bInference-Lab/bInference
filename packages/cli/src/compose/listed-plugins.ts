import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { PluginNotice } from "@binference/engine/notices";
import { createListedRunner } from "../plugins/listed-runner.js";
import { type ListingGate, listingGateOf } from "../plugins/listing-gate.js";
import { createListingWatch, type ListingWatch } from "../plugins/listing-watch.js";
import type { PluginListingRule } from "../plugins/plugin-listing-rule.js";
import type { PluginLock } from "../plugins/plugin-lock.js";
import { type PluginRecords, withPlugins } from "../plugins/plugin-records.js";
import type { PluginRunner } from "../plugins/plugin-runner.js";
import type { ProfileParts } from "./profile-parts.js";

/** The plugins of a root whose owner reviews every one, so none needs a listing (decision 0433). */
export const ownerReviewedPlugins: Pick<ProfileParts, "pluginListing"> = {
  pluginListing: { kind: "notRequired" },
};

/** Why the host turned a plugin off: it crashed 5 times in 10 minutes, or its files changed. */
type TurnedOffReason = "crashes" | "changed";

/** What the plugins are composed with: the root's rule, the lock, the host's runner and time. */
interface ListedPluginParts {
  readonly rule: PluginListingRule;
  readonly records: PluginRecords;
  /** Makes the host's runner, handed what records a plugin the host turned off. */
  readonly runnerOf: (onTurnedOff: (id: string, reason: TurnedOffReason) => void) => PluginRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly tell: (notice: PluginNotice) => void;
  /** The engine's shutdown, which ends the checks and the watch. */
  readonly life: AbortSignal;
}

/** The plugins as one composition root's listing rule runs them. */
export interface ListedPlugins {
  /** The runner every plugin operation uses: the listed runner where listings are needed. */
  readonly runner: PluginRunner;
  /** The listing checks, where the rule needs listings. */
  readonly listing?: ListingGate;
  /** Whether a plugin the lock has on is held, where the rule needs listings. */
  readonly isHeld?: (id: string) => boolean;
  /** The revocation list's watch, where the rule needs listings. */
  readonly watch?: ListingWatch;
  /** Starts the installed plugins, as `ComposedPlugins.begin` describes. */
  start(signal: AbortSignal): Promise<void>;
}

// Records a plugin the host turned off, and takes its tools from the agent through `offer`; a
// lock it cannot write is logged, and the plugin stays off until the next start.
function turnOff(
  parts: Pick<ListedPluginParts, "records" | "logger">,
  off: { readonly id: string; readonly reason: TurnedOffReason },
  offer: (lock: PluginLock) => Promise<void>,
): void {
  const { id, reason } = off;
  void parts.records
    .change(
      (lock) =>
        withPlugins(
          lock,
          lock.plugins.map((entry) =>
            entry.id === id ? { ...entry, enabled: false, disabledReason: reason } : entry,
          ),
        ),
      AbortSignal.timeout(30_000),
    )
    .then(async (lock) => offer(lock))
    .catch(() => parts.logger.warn("plugin.lock_unwritten", { sourceId: id }));
}

// Runs the installed plugins, when any is, and hands the agent the tools of those on. A start the
// engine's stop cut short is no failure; any other is logged, an unreadable lock among them,
// which runs no plugin and which every plugin operation names (`plugin.lock_unreadable`).
async function startInstalled(
  parts: Pick<ListedPluginParts, "records" | "logger">,
  runner: PluginRunner,
  signal: AbortSignal,
): Promise<void> {
  try {
    const lock = await parts.records.read(signal);
    if (lock.plugins.length === 0) {
      return;
    }
    await runner.begin(lock);
    await runner.offer(lock);
  } catch (error) {
    if (!signal.aborted) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      parts.logger.warn("plugin.begin_failed", { errorCode });
    }
  }
}

/**
 * The plugins under a composition root's listing rule (decisions 0433 and 0435): the one place the
 * listing gate, the listed runner and the revocation list's watch are joined, so no root can wire
 * them in another order. Where the rule needs no listing, the host's runner runs the plugins as
 * decision 0348 has them. Where it needs them, the start reads the revocation list first, turning
 * off any plugin it revokes, before the host starts any; the watch then reads the list every 60
 * seconds. Every offer of tools, the host's turn-offs among them, goes through the listed runner,
 * so a held plugin's tools are never offered.
 */
export function composeListedPlugins(parts: ListedPluginParts): ListedPlugins {
  const offers = { to: async (_lock: PluginLock): Promise<void> => Promise.resolve() };
  const host = parts.runnerOf((id, reason) => {
    turnOff(parts, { id, reason }, async (lock) => offers.to(lock));
  });
  const gate = listingGateOf(parts.rule, parts);
  if (gate === undefined) {
    offers.to = async (lock) => host.offer(lock);
    return { runner: host, start: async (signal) => startInstalled(parts, host, signal) };
  }
  const runner = createListedRunner({ runner: host, gate, logger: parts.logger, life: parts.life });
  offers.to = async (lock) => runner.offer(lock);
  const watch = createListingWatch({ ...parts, gate, runner });
  const start = async (signal: AbortSignal): Promise<void> => {
    try {
      await watch.check(signal);
    } catch {
      parts.logger.warn("plugin.listings_unchecked", { state: "failed" });
    }
    await startInstalled(parts, runner, signal);
    watch.run();
  };
  return { runner, listing: gate, isHeld: (id) => runner.isHeld(id), watch, start };
}
