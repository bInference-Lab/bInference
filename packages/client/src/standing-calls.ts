import type { Logger } from "@binference/core";
import { logFailure } from "./log-failure.js";

/**
 * The subscribe calls a connection holds, such as `log/follow`, which the client makes again on
 * every new connection. It keeps the last call of each operation, in the order they were made, so
 * a `log/follow` then a `log/unfollow` end unfollowed again; one call per operation bounds it.
 */
export interface StandingCalls {
  /** Keeps a subscribe call that succeeded; it replaces the call of the same operation. */
  keep(op: string, repeat: () => Promise<void>): void;
  /** Makes every kept call again, oldest first; a failure is logged. */
  repeatAll(): void;
  clear(): void;
}

/** Creates the standing calls of one client. */
export function createStandingCalls(logger: Logger): StandingCalls {
  const calls = new Map<string, () => Promise<void>>();
  return {
    keep(op, repeat) {
      calls.delete(op);
      calls.set(op, repeat);
    },
    repeatAll() {
      calls.forEach((repeat) => void logFailure(logger, "client.repeat_failed", repeat));
    },
    clear: () => calls.clear(),
  };
}
