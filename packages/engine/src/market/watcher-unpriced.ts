import type { AssetRef, ChainRef } from "@binference/chain";
import { addressPartOf, shortAddress } from "@binference/i18n";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that a chain's watcher has no price for some tokens. */
export const watcherUnpricedNoticeKey = "notice.watcherUnpriced";

/** The watched tokens of one chain that have had no confirmed price for a minute, at one moment. */
export interface UnpricedReading {
  readonly chain: ChainRef;
  /** The chain's name as the owner reads it, such as `BNB Smart Chain`. */
  readonly chainName: string;
  readonly tokens: readonly AssetRef[];
  readonly atMs: number;
}

/** How many watched tokens have no price, over every chain, and since when the first went. */
export interface UnpricedCount {
  readonly count: number;
  /** When the oldest chain's tokens went without a price; absent while every token has one. */
  readonly sinceMs?: number;
}

/** Counts the watched tokens without a price and tells the owner of them (decision 0194). */
export interface WatcherUnpricedAlerts {
  /**
   * Takes one chain's unpriced tokens. A chain with any announces `notice.watcherUnpriced` with
   * their count and the first, once until every token there is priced again, and at most once in
   * 30 minutes. It never throws: a notice never stops the reads.
   */
  check(reading: UnpricedReading): void;
  /** Forgets a chain's tokens once it watches none, but not when it told the owner last. */
  forget(chain: ChainRef): void;
  count(): UnpricedCount;
}

const noticeEveryMs = 30 * 60_000;

interface ChainUnpriced {
  readonly tokens: readonly AssetRef[];
  /** When the chain's tokens went without a price, while some do. */
  readonly sinceMs: number | undefined;
  readonly isTold: boolean;
  readonly toldAtMs: number | undefined;
}

function nextOf(before: ChainUnpriced | undefined, reading: UnpricedReading): ChainUnpriced {
  const isGoingOn = reading.tokens.length > 0;
  return {
    tokens: reading.tokens,
    sinceMs: isGoingOn ? (before?.sinceMs ?? reading.atMs) : undefined,
    isTold: isGoingOn && before?.isTold === true,
    toldAtMs: before?.toldAtMs,
  };
}

function isDue(chain: ChainUnpriced, atMs: number): boolean {
  const isQuiet = chain.toldAtMs === undefined || atMs - chain.toldAtMs >= noticeEveryMs;
  return chain.tokens.length > 0 && !chain.isTold && isQuiet;
}

/** Creates the {@link WatcherUnpricedAlerts}, which keep what they saw in memory only. */
export function createWatcherUnpricedAlerts(options: {
  readonly publish: PublishPush;
}): WatcherUnpricedAlerts {
  const chains = new Map<ChainRef, ChainUnpriced>();
  return {
    check(reading) {
      const next = nextOf(chains.get(reading.chain), reading);
      const [first] = reading.tokens;
      if (!isDue(next, reading.atMs) || first === undefined) {
        chains.set(reading.chain, next);
        return;
      }
      chains.set(reading.chain, { ...next, isTold: true, toldAtMs: reading.atMs });
      const values = {
        chain: reading.chainName,
        count: reading.tokens.length.toString(),
        token: shortAddress(addressPartOf(first)),
      };
      options.publish(noticePush({ key: watcherUnpricedNoticeKey, values }));
    },
    forget(chain) {
      const before = chains.get(chain);
      if (before !== undefined) {
        chains.set(chain, { ...before, tokens: [], sinceMs: undefined, isTold: false });
      }
    },
    count() {
      const going = [...chains.values()].filter(({ tokens }) => tokens.length > 0);
      const count = going.reduce((sum, { tokens }) => sum + tokens.length, 0);
      const since = going.flatMap(({ sinceMs }) => (sinceMs === undefined ? [] : [sinceMs]));
      return since.length === 0 ? { count } : { count, sinceMs: Math.min(...since) };
    },
  };
}
