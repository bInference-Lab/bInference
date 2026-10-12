import type { ChainRef } from "@binference/chain";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the watcher lag notice (spec 4, section 4). */
export const watcherLagNoticeKey = "notice.watcherLag";

/** How far one chain's price watcher trails the chain, read at one moment. */
export interface WatcherLagReading {
  readonly chain: ChainRef;
  /** The chain's name as the owner reads it, such as `BNB Smart Chain`. */
  readonly chainName: string;
  /** Blocks the watcher's reads trail the chain's head. */
  readonly lagBlocks: bigint;
  readonly atMs: number;
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
   * Takes one chain's lag. A chain more than 10 blocks behind for 30 seconds announces
   * `notice.watcherLag` once, until it is back within 2 blocks, and at most once in 30 minutes. It
   * never throws: a notice never stops the reads.
   */
  check(reading: WatcherLagReading): void;
  /** Forgets a chain whose watcher stopped, since it watches no token. */
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

interface ChainLag {
  readonly reading: WatcherLagReading;
  readonly state: WatcherState;
  /** When it stopped being ok. */
  readonly sinceMs: number | undefined;
  /** When it started failing. */
  readonly failingSinceMs: number | undefined;
  readonly isNoticed: boolean;
  readonly noticedAtMs: number | undefined;
}

const rank: Readonly<Record<WatcherState, number>> = { ok: 0, warn: 1, fail: 2 };

function nextLag(before: ChainLag | undefined, reading: WatcherLagReading): ChainLag {
  const state = watcherStateOf(reading.lagBlocks);
  const sinceMs = state === "ok" ? undefined : (before?.sinceMs ?? reading.atMs);
  const failingSinceMs = state === "fail" ? (before?.failingSinceMs ?? reading.atMs) : undefined;
  return {
    reading,
    state,
    sinceMs,
    failingSinceMs,
    isNoticed: state !== "ok" && before?.isNoticed === true,
    noticedAtMs: before?.noticedAtMs,
  };
}

function isDue(lag: ChainLag): boolean {
  const { failingSinceMs, noticedAtMs, reading } = lag;
  const hasFailedLong =
    failingSinceMs !== undefined && reading.atMs - failingSinceMs >= noticeAfterMs;
  const isQuiet = noticedAtMs === undefined || reading.atMs - noticedAtMs >= noticeEveryMs;
  return hasFailedLong && !lag.isNoticed && isQuiet;
}

/** Creates the {@link WatcherLagAlerts}, which keep what they saw in memory only. */
export function createWatcherLagAlerts(options: {
  readonly publish: PublishPush;
}): WatcherLagAlerts {
  const lags = new Map<ChainRef, ChainLag>();
  return {
    check(reading) {
      const lag = nextLag(lags.get(reading.chain), reading);
      if (!isDue(lag)) {
        lags.set(reading.chain, lag);
        return;
      }
      lags.set(reading.chain, { ...lag, isNoticed: true, noticedAtMs: reading.atMs });
      options.publish(
        noticePush({
          key: watcherLagNoticeKey,
          values: { chain: reading.chainName, blocks: reading.lagBlocks.toString() },
        }),
      );
    },
    forget(chain) {
      lags.delete(chain);
    },
    health() {
      const worst = [...lags.values()].reduce<ChainLag | undefined>(
        (found, lag) =>
          found === undefined ||
          rank[lag.state] > rank[found.state] ||
          (rank[lag.state] === rank[found.state] && lag.reading.lagBlocks > found.reading.lagBlocks)
            ? lag
            : found,
        undefined,
      );
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
