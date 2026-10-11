import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Clock, Logger, Random } from "@binference/core";

/**
 * The runtime's own clock, random bytes and logger, for its composition root alone: wall time,
 * waits on the event loop that end when their signal aborts, and the OS's secure generator. The
 * runtime writes no log file; the engine logs what it does through the protocol.
 */
export const processPorts: {
  readonly clock: Clock;
  readonly random: Random;
  readonly logger: Logger;
} = {
  clock: {
    now: () => Date.now(),
    sleep: async (delayMs, signal) => delay(delayMs, undefined, { signal }),
  },
  random: { bytes: (length) => new Uint8Array(randomBytes(length)) },
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => processPorts.logger,
  },
};
