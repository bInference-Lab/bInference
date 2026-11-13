import type { Logger } from "@binference/core";
import type { ListingFailure, ListingGate } from "./listing-gate.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import type { PluginRunner } from "./plugin-runner.js";

/** The plugin runner under the listing rule, which holds plugins whose listing does not pass. */
export interface ListedRunner extends PluginRunner {
  /** Whether a plugin the lock has on is held: not run and offered no tools. */
  isHeld(id: string): boolean;
  /** Holds a plugin: stops it and takes its tools from the agent's next settings. */
  hold(id: string): Promise<void>;
}

// The lock as the runner sees it: each held plugin off, so it neither starts nor offers tools.
function withHeldOff(lock: PluginLock, held: ReadonlySet<string>): PluginLock {
  return {
    ...lock,
    plugins: lock.plugins.map((entry) =>
      held.has(entry.id) ? { ...entry, enabled: false } : entry,
    ),
  };
}

// Why a plugin's check at start kept it from running, as the log names it.
const reasonOf = (failure: ListingFailure): string =>
  "reason" in failure ? failure.reason : failure.code;

/**
 * Runs the installed plugins under the listing rule (decision 0433). At the first `begin`, each
 * enabled plugin's listing is checked before the host starts any; one whose check does not pass is
 * held: not started, its tools not offered, its lock entry unchanged. `run`, which follows an add or
 * an enable whose check passed, ends a plugin's hold and runs it.
 */
export function createListedRunner(parts: {
  readonly runner: PluginRunner;
  readonly gate: ListingGate;
  readonly logger: Logger;
  /** The engine's shutdown, which the start's checks run under. */
  readonly life: AbortSignal;
}): ListedRunner {
  const { runner, gate, logger } = parts;
  const held = new Set<string>();
  // The host starts the plugins at one `begin` only; a later one, as an install asks, checks none.
  let hasBegun = false;
  const check = async (entry: LockedPlugin): Promise<void> => {
    const checked = await gate.forEntry(entry, parts.life);
    if (!checked.ok) {
      held.add(entry.id);
      logger.warn("plugin.listing_held", { sourceId: entry.id, reason: reasonOf(checked.failure) });
    }
  };
  return {
    isHeld: (id) => held.has(id),
    hold: async (id) => {
      held.add(id);
      await runner.stop(id);
    },
    begin: async (lock) => {
      if (hasBegun) {
        return false;
      }
      await Promise.all(lock.plugins.filter(({ enabled }) => enabled).map(check));
      hasBegun = await runner.begin(withHeldOff(lock, held));
      return hasBegun;
    },
    run: async (entry) => {
      held.delete(entry.id);
      await runner.run(entry);
    },
    stop: async (id) => runner.stop(id),
    call: async (call, signal) => runner.call(call, signal),
    offer: async (lock) => runner.offer(withHeldOff(lock, held)),
  };
}
