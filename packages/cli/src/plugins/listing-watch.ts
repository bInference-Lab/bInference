import type { Clock, Logger } from "@binference/core";
import type { PluginNotice } from "@binference/engine/notices";
import { revokedEntry } from "./listed-install.js";
import type { ListedRunner } from "./listed-runner.js";
import type { ListingGate } from "./listing-gate.js";
import { createStaleState, holdStale, resumeHeld, type StaleState } from "./listing-holds.js";
import type { RevocationList } from "./plugin-listing.schema.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import { type PluginRecords, withPlugins } from "./plugin-records.js";
import type { RevocationFloor } from "./revocation-holder.js";

/** The revocation list at work on a running engine (decision 0435). */
export interface ListingWatch {
  /** Reads the list now and acts on it: turns revoked plugins off, holds or runs again. */
  check(signal: AbortSignal): Promise<void>;
  /** Checks every 60 seconds on the clock, from 60 seconds after the start, until it stops. */
  run(): void;
}

/** How often the engine reads the revocation list (decision 0435). */
const everyMs = 60_000;

interface WatchParts {
  readonly gate: ListingGate;
  readonly records: PluginRecords;
  readonly runner: ListedRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly tell: (notice: PluginNotice) => void;
  /** The engine's shutdown, which ends the reads. */
  readonly life: AbortSignal;
}

// The entries a list names that the lock does not mark revoked yet.
const newlyNamed = (list: RevocationList, lock: PluginLock): readonly LockedPlugin[] =>
  lock.plugins.filter(
    ({ listing }) =>
      listing !== undefined && listing.revoked !== true && list.revoked.includes(listing.listing),
  );

const sameFloor = (lock: PluginLock, floor: RevocationFloor | undefined): boolean =>
  JSON.stringify(lock.revocations) === JSON.stringify(floor);

// Marks, in one change, every plugin the list names revoked and off, and writes the list's floor,
// so a crash between them cannot leave a plugin on under a newer list. The plugins are picked
// inside the change, so an update that landed since the read keeps its own listing; answers
// those it marked.
async function turnOffRevoked(
  parts: WatchParts,
  list: RevocationList,
  signal: AbortSignal,
): Promise<readonly LockedPlugin[]> {
  const floor = parts.gate.revocations.floor();
  const before = await parts.records.read(signal);
  if (newlyNamed(list, before).length === 0 && sameFloor(before, floor)) {
    return [];
  }
  const marked: { named: readonly LockedPlugin[] } = { named: [] };
  const lock = await parts.records.change((now) => {
    marked.named = newlyNamed(list, now);
    const ended = new Set(marked.named.map(({ id }) => id));
    const plugins = now.plugins.map((entry) => (ended.has(entry.id) ? revokedEntry(entry) : entry));
    return floor === undefined
      ? withPlugins(now, plugins)
      : { ...withPlugins(now, plugins), revocations: floor };
  }, signal);
  const { named } = marked;
  if (named.length > 0) {
    await Promise.all(named.map(async ({ id }) => parts.runner.stop(id)));
    await parts.runner.offer(lock);
  }
  return named;
}

async function check(parts: WatchParts, stale: StaleState, signal: AbortSignal): Promise<void> {
  await parts.gate.refresh(signal);
  const list = parts.gate.revocations.fresh();
  if (list === undefined) {
    await holdStale(parts, stale, signal);
    return;
  }
  const revoked = await turnOffRevoked(parts, list, signal);
  for (const entry of revoked) {
    parts.logger.warn("plugin.revoked", {
      sourceId: entry.id,
      ...(entry.listing === undefined ? {} : { listing: entry.listing.listing }),
    });
    parts.tell({ kind: "revoked", plugin: entry.id, version: entry.version });
  }
  await resumeHeld(parts, stale, signal);
}

// Holds the listed plugins at the moment the newest list taken expires, from a timer on the clock,
// so a check that has not ended by then cannot keep them running; a list taken since moves it.
function createExpiryHold(parts: WatchParts, stale: StaleState): () => void {
  const armed: { timer: AbortController | undefined } = { timer: undefined };
  const holdAt = async (expiresAt: number, until: AbortSignal): Promise<void> => {
    try {
      await parts.clock.sleep(Math.max(0, expiresAt - parts.clock.now()), until);
    } catch {
      return;
    }
    if (parts.gate.revocations.fresh() === undefined) {
      await holdStale(parts, stale, parts.life);
    }
  };
  return () => {
    armed.timer?.abort();
    const list = parts.gate.revocations.newest();
    if (list === undefined) {
      return;
    }
    const timer = new AbortController();
    armed.timer = timer;
    void holdAt(list.expiresAt, AbortSignal.any([timer.signal, parts.life])).catch(() => {
      parts.logger.warn("plugin.listings_unchecked", { state: "failed" });
    });
  };
}

/**
 * Keeps the revocation list at work while the engine runs (decision 0435): it reads the list every
 * 60 seconds, each read with the gate's 15 seconds. A list it takes that names a plugin's listing
 * marks that plugin revoked and off, keeping the reason it was off for, in the same lock change
 * that writes the list's floor, then stops it and takes its tools away, and the owner gets
 * `notice.pluginRevoked` once. At each check that finds no fresh list, and at the moment the newest
 * list taken expires, every listed plugin on is held, and the owner gets `notice.pluginsHeld` at
 * most once in 24 hours; at the next fresh list, each held plugin whose listing passes runs again.
 */
export function createListingWatch(parts: WatchParts): ListingWatch {
  const stale = createStaleState();
  const armExpiry = createExpiryHold(parts, stale);
  const checked = async (signal: AbortSignal): Promise<void> => {
    try {
      await check(parts, stale, signal);
    } finally {
      armExpiry();
    }
  };
  const once = async (): Promise<void> => {
    try {
      await checked(parts.life);
    } catch {
      parts.logger.warn("plugin.listings_unchecked", { state: "failed" });
    }
  };
  // Each read waits its 60 seconds and starts the next wait, so no chain of reads outlives the
  // one before.
  const tick = async (): Promise<void> => {
    try {
      await parts.clock.sleep(everyMs, parts.life);
    } catch {
      return;
    }
    await once();
    void tick();
  };
  return {
    check: checked,
    run: () => {
      void tick();
    },
  };
}
