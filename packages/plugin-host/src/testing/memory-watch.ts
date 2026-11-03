import type { Clock } from "@binference/core";
import { createPlatform } from "@binference/platform";
import type { ResidentWatch } from "../host/watch-resident.js";

/**
 * A memory watch for tests: this OS's real reading of a plugin's resident size, its waits on the
 * test's clock, so a test that never moves the clock never reads, and its limit.
 */
export function testMemoryWatch(clock: Clock, limitBytes?: number): ResidentWatch {
  const { residentBytes } = createPlatform();
  return {
    read: residentBytes,
    wait: async (delayMs, signal) => clock.sleep(delayMs, signal),
    ...(limitBytes === undefined ? {} : { limitBytes }),
  };
}
