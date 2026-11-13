import type { Clock, Logger } from "@binference/core";
import type { PluginNotice } from "@binference/engine/notices";
import type { ListedRunner } from "./listed-runner.js";
import type { ListingGate } from "./listing-gate.js";
import type { LockedPlugin } from "./plugin-lock.js";
import type { PluginRecords } from "./plugin-records.js";

/** The least time between two notices that the listed plugins are held (decision 0435). */
const heldNoticeMs = 86_400_000;

/** What the holds of the listed plugins act on. */
export interface HoldParts {
  readonly gate: ListingGate;
  readonly records: PluginRecords;
  readonly runner: ListedRunner;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly tell: (notice: PluginNotice) => void;
}

/** Whether the listed plugins are held for want of a fresh revocation list. */
export interface StaleState {
  /** Marks the list stale: whether it was fresh before. */
  begin(): boolean;
  /** Marks the list fresh: whether it was stale before. */
  end(): boolean;
}

/** A list fresh until a check finds it stale. */
export function createStaleState(): StaleState {
  const state = { isStale: false };
  return {
    begin: () => {
      const wasFresh = !state.isStale;
      state.isStale = true;
      return wasFresh;
    },
    end: () => {
      const wasStale = state.isStale;
      state.isStale = false;
      return wasStale;
    },
  };
}

// Tells the owner the listed plugins are held, at most once in 24 hours across restarts: the time
// it last told is kept in the lock.
async function tellHeld(parts: HoldParts, signal: AbortSignal): Promise<void> {
  const now = parts.clock.now();
  const told: { isDue: boolean } = { isDue: false };
  await parts.records.change((lock) => {
    told.isDue = lock.heldToldAt === undefined || now - lock.heldToldAt >= heldNoticeMs;
    return told.isDue ? { ...lock, heldToldAt: now } : lock;
  }, signal);
  if (told.isDue) {
    parts.tell({ kind: "held" });
  }
}

/**
 * Holds every listed plugin on that is not held yet, while no fresh revocation list is held
 * (decision 0435). It runs at each check that finds the list stale, so a plugin that started
 * since the last one is held too; with nothing new to hold it does nothing. The first hold of an
 * outage is logged and told to the owner at most once in 24 hours.
 */
export async function holdStale(
  parts: HoldParts,
  stale: StaleState,
  signal: AbortSignal,
): Promise<void> {
  const lock = await parts.records.read(signal);
  const loose = lock.plugins.filter(
    (entry) => entry.enabled && entry.listing !== undefined && !parts.runner.isHeld(entry.id),
  );
  if (loose.length === 0) {
    return;
  }
  await Promise.all(loose.map(async (entry) => parts.runner.hold(entry)));
  await parts.runner.offer(lock);
  if (!stale.begin()) {
    return;
  }
  parts.logger.warn("plugin.listings_held", { state: "stale" });
  await tellHeld(parts, signal);
}

// Whether the lock still holds the entry a check passed: on, the same version and listing.
const isStill = (now: LockedPlugin | undefined, checked: LockedPlugin): now is LockedPlugin =>
  now !== undefined &&
  now.enabled &&
  now.version === checked.version &&
  now.listing?.listing === checked.listing?.listing;

/**
 * Checks each held plugin on again under a fresh list and runs those whose listing passes
 * (decision 0435). The lock is read again after the checks, so only a plugin still on, at the
 * version and listing its check passed, runs; one an operation stopped since stays stopped.
 */
export async function resumeHeld(
  parts: HoldParts,
  stale: StaleState,
  signal: AbortSignal,
): Promise<void> {
  const wasStale = stale.end();
  const before = await parts.records.read(signal);
  const waiting = before.plugins.filter((entry) => entry.enabled && parts.runner.isHeld(entry.id));
  const checked = await Promise.all(
    waiting.map(async (entry) => ((await parts.gate.forEntry(entry, signal)).ok ? [entry] : [])),
  );
  const lock = await parts.records.read(signal);
  const ran = await Promise.all(
    checked.flat().map(async (entry) => {
      const now = lock.plugins.find(({ id }) => id === entry.id);
      return isStill(now, entry) && (await parts.runner.resume(now));
    }),
  );
  if (ran.includes(true)) {
    await parts.runner.offer(lock);
  }
  if (wasStale) {
    parts.logger.info("plugin.listings_resumed", { state: "fresh" });
  }
}
