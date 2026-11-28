import type { ChainRef } from "@binference/chain";
import type { Logger } from "@binference/core";

/** The log of one chain's log watcher reads. */
export interface WatcherReadLog {
  /** A read failed with this code and will be tried again. */
  failed(errorCode: string): void;
  /** A read was stored. */
  stored(): void;
}

/** The events a watcher's read log writes: a failed read, and the read that ends an outage. */
export interface WatcherReadEvents {
  readonly failed: string;
  readonly resumed: string;
}

/**
 * Creates the log of one chain's log watcher reads, which tells each outage once: its first failed
 * read at warn as `events.failed`, each later new reason in it at info, a reason it already told
 * never again, and the first read stored after it at info as `events.resumed`. The next outage is
 * told again from its first failed read. The reasons it keeps are error codes, so they stay few.
 */
export function createWatcherReadLog(
  logger: Logger,
  chain: ChainRef,
  events: WatcherReadEvents,
): WatcherReadLog {
  const told = new Set<string>();
  return {
    failed(errorCode) {
      if (told.has(errorCode)) {
        return;
      }
      const fields = { chain, errorCode };
      if (told.size === 0) {
        logger.warn(events.failed, fields);
      } else {
        logger.info(events.failed, fields);
      }
      told.add(errorCode);
    },
    stored() {
      if (told.size > 0) {
        told.clear();
        logger.info(events.resumed, { chain });
      }
    },
  };
}
