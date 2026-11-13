import type { Logger } from "@binference/core";
import type { ListingFailure, ListingGate } from "./listing-gate.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import type { PluginRunner } from "./plugin-runner.js";

/** The plugin runner under the listing rule, which holds plugins whose listing does not pass. */
export interface ListedRunner extends PluginRunner {
  /** Whether a plugin the lock has on is held: not run and offered no tools. */
  isHeld(id: string): boolean;
  /** Holds a plugin's entry: stops it and takes its tools from the agent's next settings. */
  hold(entry: LockedPlugin): Promise<void>;
  /**
   * Ends the hold of an entry whose listing check passed now and runs it: only when the entry is
   * the one held and no operation stopped the plugin since its last `run`. Answers whether it ran.
   */
  resume(entry: LockedPlugin): Promise<boolean>;
}

// Which entry a hold is on: a plugin's version under its listing. An update is another entry.
const heldEntryOf = (entry: LockedPlugin): string =>
  `${entry.version} ${entry.listing?.listing ?? ""}`;

// The lock as the runner sees it: each held plugin off, so it neither starts nor offers tools.
function withHeldOff(lock: PluginLock, held: ReadonlyMap<string, string>): PluginLock {
  return {
    ...lock,
    plugins: lock.plugins.map((entry) =>
      held.has(entry.id) ? { ...entry, enabled: false } : entry,
    ),
  };
}

// Why a plugin's check kept it from running, as the log names it.
const reasonOf = (failure: ListingFailure): string =>
  "reason" in failure ? failure.reason : failure.code;

interface RunnerState {
  /** The plugins held, each with the entry it is held on. */
  readonly held: Map<string, string>;
  /** The plugins an operation stopped since their last `run`, which a resume leaves stopped. */
  readonly stopped: Set<string>;
  /** Whether the host started the installed plugins: only the first start checks every one. */
  hasBegun: boolean;
}

// Checks an entry's listing now: a pass ends any hold, a failure holds the entry.
async function passes(
  parts: { readonly gate: ListingGate; readonly logger: Logger; readonly life: AbortSignal },
  state: RunnerState,
  entry: LockedPlugin,
): Promise<boolean> {
  const checked = await parts.gate.forEntry(entry, parts.life);
  if (checked.ok) {
    state.held.delete(entry.id);
    return true;
  }
  state.held.set(entry.id, heldEntryOf(entry));
  parts.logger.warn("plugin.listing_held", {
    sourceId: entry.id,
    reason: reasonOf(checked.failure),
  });
  return false;
}

/**
 * Runs the installed plugins under the listing rule (decisions 0433 and 0435). At the first
 * `begin`, each enabled plugin's listing is checked before the host starts any; one whose check
 * does not pass is held: not started, its tools not offered, its lock entry unchanged. `run`
 * starts a plugin only after its own check passes against a fresh revocation list, and starts
 * nothing for the entry a plugin is held on: only a passed check ends a hold, the watch's
 * `resume` among them. A plugin an operation stopped is never resumed until an operation runs it.
 */
export function createListedRunner(parts: {
  readonly runner: PluginRunner;
  readonly gate: ListingGate;
  readonly logger: Logger;
  /** The engine's shutdown, which the checks run under. */
  readonly life: AbortSignal;
}): ListedRunner {
  const { runner } = parts;
  const state: RunnerState = { held: new Map(), stopped: new Set(), hasBegun: false };
  return {
    isHeld: (id) => state.held.has(id),
    hold: async (entry) => {
      state.held.set(entry.id, heldEntryOf(entry));
      await runner.stop(entry.id);
    },
    resume: async (entry) => {
      if (state.stopped.has(entry.id) || state.held.get(entry.id) !== heldEntryOf(entry)) {
        return false;
      }
      state.held.delete(entry.id);
      await runner.run(entry);
      return true;
    },
    begin: async (lock) => {
      if (state.hasBegun) {
        return false;
      }
      const enabled = lock.plugins.filter((entry) => entry.enabled);
      await Promise.all(enabled.map(async (entry) => passes(parts, state, entry)));
      state.hasBegun = await runner.begin(withHeldOff(lock, state.held));
      return state.hasBegun;
    },
    run: async (entry) => {
      state.stopped.delete(entry.id);
      if (state.held.get(entry.id) === heldEntryOf(entry)) {
        return;
      }
      if (await passes(parts, state, entry)) {
        await runner.run(entry);
      }
    },
    stop: async (id) => {
      state.stopped.add(id);
      await runner.stop(id);
    },
    call: async (call, signal) => runner.call(call, signal),
    offer: async (lock) => runner.offer(withHeldOff(lock, state.held)),
  };
}
