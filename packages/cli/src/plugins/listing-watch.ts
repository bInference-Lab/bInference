import type { Clock, Logger } from "@binference/core";
import type { PluginNotice } from "@binference/engine/notices";
import { revokedEntry } from "./listed-install.js";
import type { ListedRunner } from "./listed-runner.js";
import type { ListingGate } from "./listing-gate.js";
import type { RevocationList } from "./plugin-listing.schema.js";
import type { LockedPlugin, PluginLock } from "./plugin-lock.js";
import { type PluginRecords, withPlugins } from "./plugin-records.js";
import type { RevocationFloor } from "./revocation-holder.js";

/** The revocation list at work on a running engine (decision 0435). */
export interface ListingWatch {
  /** Starts from the floor the lock kept, before the first start checks any listing. */
  restore(lock: PluginLock): void;
  /** Reads the list now and acts on it: turns revoked plugins off, holds or runs again. */
  check(signal: AbortSignal): Promise<void>;
  /** Checks every 60 seconds on the clock, from 60 seconds after the start, until it stops. */
  run(): void;
}

/** How often the engine reads the revocation list (decision 0435). */
const everyMs = 60_000;
/** The least time between two notices that the listed plugins are held. */
const heldNoticeMs = 86_400_000;

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

// Whether every listed plugin is held for want of a fresh list, and when the owner was told.
interface HoldState {
  /** Begins a hold: whether one was not under way, and whether the owner is told of it. */
  begin(now: number): { readonly isNew: boolean; readonly shouldTell: boolean };
  /** Ends a hold: whether one was under way. */
  end(): boolean;
}

function createHoldState(): HoldState {
  let isStale = false;
  let toldAt: number | undefined;
  return {
    begin: (now) => {
      if (isStale) {
        return { isNew: false, shouldTell: false };
      }
      isStale = true;
      const shouldTell = toldAt === undefined || now - toldAt >= heldNoticeMs;
      toldAt = shouldTell ? now : toldAt;
      return { isNew: true, shouldTell };
    },
    end: () => {
      const was = isStale;
      isStale = false;
      return was;
    },
  };
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

// Holds every listed plugin on while no fresh list is held, telling the owner once a day at most.
async function holdAll(parts: WatchParts, held: HoldState, signal: AbortSignal): Promise<void> {
  const begun = held.begin(parts.clock.now());
  if (!begun.isNew) {
    return;
  }
  const lock = await parts.records.read(signal);
  const on = lock.plugins.filter((entry) => entry.enabled && entry.listing !== undefined);
  await Promise.all(on.map(async ({ id }) => parts.runner.hold(id)));
  await parts.runner.offer(lock);
  parts.logger.warn("plugin.listings_held", { state: "stale" });
  if (begun.shouldTell) {
    parts.tell({ kind: "held" });
  }
}

// Checks each held plugin on again and runs those whose listing passes now.
async function runAgain(parts: WatchParts, held: HoldState, signal: AbortSignal): Promise<void> {
  const wasStale = held.end();
  const lock = await parts.records.read(signal);
  const waiting = lock.plugins.filter((entry) => entry.enabled && parts.runner.isHeld(entry.id));
  const checked = await Promise.all(
    waiting.map(async (entry) => ((await parts.gate.forEntry(entry, signal)).ok ? [entry] : [])),
  );
  const passed = checked.flat();
  await Promise.all(passed.map(async (entry) => parts.runner.run(entry)));
  if (passed.length > 0) {
    await parts.runner.offer(lock);
  }
  if (wasStale) {
    parts.logger.info("plugin.listings_resumed", { state: "fresh" });
  }
}

async function check(parts: WatchParts, held: HoldState, signal: AbortSignal): Promise<void> {
  await parts.gate.refresh(signal);
  const list = parts.gate.revocations.fresh();
  if (list === undefined) {
    await holdAll(parts, held, signal);
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
  await runAgain(parts, held, signal);
}

/**
 * Keeps the revocation list at work while the engine runs (decision 0435): it reads the list every
 * 60 seconds, each read with the gate's 15 seconds. A list it takes that names a plugin's listing
 * marks that plugin revoked and off, keeping the reason it was off for, in the same lock change
 * that writes the list's floor, then stops it and takes its tools away, and the owner gets
 * `notice.pluginRevoked` once. Once the newest
 * list taken expires, every listed plugin on is held and the owner gets `notice.pluginsHeld`, at
 * most once a day; at the next fresh list, each held plugin whose listing passes runs again.
 */
export function createListingWatch(parts: WatchParts): ListingWatch {
  const held = createHoldState();
  const once = async (signal: AbortSignal): Promise<void> => {
    try {
      await check(parts, held, signal);
    } catch {
      parts.logger.warn("plugin.listings_unchecked", { state: "failed" });
    }
  };
  // The start's checks read the list first; each read then waits its 60 seconds and starts the
  // next wait, so no chain of reads outlives the one before.
  const tick = async (): Promise<void> => {
    try {
      await parts.clock.sleep(everyMs, parts.life);
    } catch {
      return;
    }
    await once(parts.life);
    void tick();
  };
  return {
    restore: (lock) => parts.gate.revocations.restore(lock.revocations),
    check: async (signal) => check(parts, held, signal),
    run: () => {
      void tick();
    },
  };
}
