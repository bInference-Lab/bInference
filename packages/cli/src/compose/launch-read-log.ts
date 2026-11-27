import type { ChainRef } from "@binference/chain";
import type { Logger } from "@binference/core";

/** The log of one chain's launch feed reads. */
export interface LaunchReadLog {
  /** A read failed with this code and will be tried again. */
  failed(errorCode: string): void;
  /** A read was stored. */
  stored(): void;
}

/**
 * Creates the log of one chain's launch feed reads, which tells each outage once: its first failed
 * read at warn as `watcher.launch_read_failed`, each later new reason in it at info, a reason it
 * already told never again, and the first read stored after it at info as
 * `watcher.launch_reads_resumed`. The reasons it keeps are error codes, so they stay few.
 */
export function createLaunchReadLog(logger: Logger, chain: ChainRef): LaunchReadLog {
  const told = new Set<string>();
  return {
    failed(errorCode) {
      if (told.has(errorCode)) {
        return;
      }
      const fields = { chain, errorCode };
      if (told.size === 0) {
        logger.warn("watcher.launch_read_failed", fields);
      } else {
        logger.info("watcher.launch_read_failed", fields);
      }
      told.add(errorCode);
    },
    stored() {
      if (told.size > 0) {
        told.clear();
        logger.info("watcher.launch_reads_resumed", { chain });
      }
    },
  };
}
