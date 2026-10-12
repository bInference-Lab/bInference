import type { ChainRef } from "@binference/chain";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the watcher lag notice (spec 4, section 4). */
export const watcherLagNoticeKey = "notice.watcherLag";

/** The message key of the notice that a chain's watcher stopped on a fault (spec 4, section 4). */
export const watcherStoppedNoticeKey = "notice.watcherStopped";

/** How far one chain's price watcher trails the chain, read at one moment. */
export interface WatcherLagReading {
  readonly chain: ChainRef;
  /** The chain's name as the owner reads it, such as `BNB Smart Chain`. */
  readonly chainName: string;
  /** Blocks the watcher's reads trail the chain's head. */
  readonly lagBlocks: bigint;
  readonly atMs: number;
  /** The watcher stopped on a fault and waits to restart: it reads nothing (decision 0194). */
  readonly isDown?: boolean;
}

/** The state of a watcher's health signal. */
export type WatcherState = "ok" | "warn" | "fail";

/** The `watcher` health signal: the worst chain's state, since when it was not ok, and its lag. */
export interface WatcherHealth {
  readonly state: WatcherState;
  /** When the worst chain stopped being ok; absent while it is ok. */
  readonly since?: number;
  readonly lagBlocks: bigint;
}

/** Turns the watchers' lag into the `watcher` health signal and tells the owner when it stays behind. */
export interface WatcherLagAlerts {
  /**
   * Takes one chain's lag. A chain more than 10 blocks behind, and not back within 2 since, for 30
   * seconds announces `notice.watcherLag` once, until it is back within 2 blocks, and at most once
   * in 30 minutes. A
   * chain whose watcher is down fails, and announces `notice.watcherStopped` at once, once a stop
   * and at most once in 30 minutes. It never throws: a notice never stops the reads.
   */
  check(reading: WatcherLagReading): void;
  /**
   * Forgets a chain whose watcher stopped, since it watches no token, but not when it told the
   * owner last.
   */
  forget(chain: ChainRef): void;
  /** The signal over every chain read; undefined while no watcher reads. */
  health(): WatcherHealth | undefined;
}

/** Within 2 blocks, about a second on BNB Smart Chain, a price is as good as the head's. */
const okLagBlocks = 2n;
/** Past 10 blocks, about 4.5 seconds there, a stop-loss fills late. */
const warnLagBlocks = 10n;
const noticeAfterMs = 30_000;
const noticeEveryMs = 30 * 60_000;

/** The state of a lag: ok within 2 blocks, a warning within 10, else failed. */
export function watcherStateOf(lagBlocks: bigint): WatcherState {
  if (lagBlocks <= okLagBlocks) {
    return "ok";
  }
  return lagBlocks <= warnLagBlocks ? "warn" : "fail";
}

/** Whether a notice was told in the episode under way, and when it was told last. */
interface Told {
  readonly isTold: boolean;
  readonly atMs: number | undefined;
}

interface ChainLag {
  readonly reading: WatcherLagReading;
  readonly state: WatcherState;
  /** When it stopped being ok. */
  readonly sinceMs: number | undefined;
  /** When it started failing. */
  readonly failingSinceMs: number | undefined;
  readonly lag: Told;
  readonly stop: Told;
}

const rank: Readonly<Record<WatcherState, number>> = { ok: 0, warn: 1, fail: 2 };
// An episode that ends forgets that it was told, never when it was told last.
function carried(told: Told | undefined, episode: { readonly isGoingOn: boolean }): Told {
  return { isTold: episode.isGoingOn && told?.isTold === true, atMs: told?.atMs };
}

/** What a chain's next reading starts from: its last, or what was kept once it was forgotten. */
type LagBefore = Pick<ChainLag, "lag" | "stop"> & {
  readonly sinceMs?: number | undefined;
  readonly failingSinceMs?: number | undefined;
};

function keptFailing(state: WatcherState, before: LagBefore | undefined): number | undefined {
  return state === "ok" ? undefined : before?.failingSinceMs;
}

function nextLag(before: LagBefore | undefined, reading: WatcherLagReading): ChainLag {
  const isDown = reading.isDown === true;
  const state = isDown ? "fail" : watcherStateOf(reading.lagBlocks);
  const sinceMs = state === "ok" ? undefined : (before?.sinceMs ?? reading.atMs);
  // A lag fails from its first block past 10 until it is back within 2 (decision 0194), so a lag
  // that swings across 10 still counts its time.
  const failingSinceMs =
    state === "fail" ? (before?.failingSinceMs ?? reading.atMs) : keptFailing(state, before);
  return {
    reading,
    state,
    sinceMs,
    failingSinceMs,
    lag: carried(before?.lag, { isGoingOn: state !== "ok" }),
    stop: carried(before?.stop, { isGoingOn: isDown }),
  };
}

const isQuiet = (told: Told, atMs: number): boolean =>
  !told.isTold && (told.atMs === undefined || atMs - told.atMs >= noticeEveryMs);

function isLagDue(lag: ChainLag): boolean {
  const { failingSinceMs, reading } = lag;
  const hasFailedLong =
    failingSinceMs !== undefined && reading.atMs - failingSinceMs >= noticeAfterMs;
  const isFailingNow = lag.state === "fail" && reading.isDown !== true;
  return isFailingNow && hasFailedLong && isQuiet(lag.lag, reading.atMs);
}

const toldAt = (atMs: number): Told => ({ isTold: true, atMs });

// The notice a chain's reading calls for, if any, and the chain's state once it is told.
function noticeOf(lag: ChainLag): { readonly push?: NoticeKey; readonly lag: ChainLag } {
  const { reading } = lag;
  if (reading.isDown === true && isQuiet(lag.stop, reading.atMs)) {
    return { push: watcherStoppedNoticeKey, lag: { ...lag, stop: toldAt(reading.atMs) } };
  }
  return isLagDue(lag)
    ? { push: watcherLagNoticeKey, lag: { ...lag, lag: toldAt(reading.atMs) } }
    : { lag };
}

type NoticeKey = typeof watcherLagNoticeKey | typeof watcherStoppedNoticeKey;

function valuesOf(key: NoticeKey, reading: WatcherLagReading): Readonly<Record<string, string>> {
  return key === watcherLagNoticeKey
    ? { chain: reading.chainName, blocks: reading.lagBlocks.toString() }
    : { chain: reading.chainName };
}

function worstOf(lags: Iterable<ChainLag>): ChainLag | undefined {
  let worst: ChainLag | undefined;
  for (const lag of lags) {
    const isWorse =
      worst === undefined ||
      rank[lag.state] > rank[worst.state] ||
      (rank[lag.state] === rank[worst.state] && lag.reading.lagBlocks > worst.reading.lagBlocks);
    worst = isWorse ? lag : worst;
  }
  return worst;
}

/** Creates the {@link WatcherLagAlerts}, which keep what they saw in memory only. */
export function createWatcherLagAlerts(options: {
  readonly publish: PublishPush;
}): WatcherLagAlerts {
  const lags = new Map<ChainRef, ChainLag>();
  // When each forgotten chain told the owner last, so a watcher that stops and starts again is
  // still told at most once in 30 minutes.
  const told = new Map<ChainRef, LagBefore>();
  return {
    check(reading) {
      const before = lags.get(reading.chain) ?? told.get(reading.chain);
      const next = noticeOf(nextLag(before, reading));
      lags.set(reading.chain, next.lag);
      if (next.push !== undefined) {
        options.publish(noticePush({ key: next.push, values: valuesOf(next.push, reading) }));
      }
    },
    forget(chain) {
      const before = lags.get(chain);
      if (before !== undefined) {
        told.set(chain, { lag: before.lag, stop: before.stop });
      }
      lags.delete(chain);
    },
    health() {
      const worst = worstOf(lags.values());
      if (worst === undefined) {
        return undefined;
      }
      const { state, sinceMs } = worst;
      return {
        state,
        ...(sinceMs === undefined ? {} : { since: sinceMs }),
        lagBlocks: worst.reading.lagBlocks,
      };
    },
  };
}
