import type { Clock } from "@binference/core";
import type { BrowserDriver } from "@binference/engine/browser";

/** How long the browser may sit without a call, and the clock that times it. */
export interface IdleStopOptions {
  readonly clock: Clock;
  readonly idleMs: number;
}

/** The agent's browser stops after this long without a call: 10 minutes (decision 0401). */
export const browserIdleMs: number = 10 * 60_000;

/**
 * A driver that stops its browser once `idleMs` passed after its last call ended with no call
 * under way. A stop ends the wait, so a stopped engine keeps no timer.
 */
export function withIdleStop(driver: BrowserDriver, options: IdleStopOptions): BrowserDriver {
  const state = { calls: 0, wait: new AbortController() };
  const disarm = (): void => {
    state.wait.abort();
  };
  const arm = (): void => {
    disarm();
    if (state.calls > 0 || !driver.isRunning()) {
      return;
    }
    const wait = new AbortController();
    state.wait = wait;
    void options.clock.sleep(options.idleMs, wait.signal).then(
      async () => (wait.signal.aborted || state.calls > 0 ? undefined : driver.stop()),
      () => undefined,
    );
  };
  return {
    run: async (request, call) => {
      state.calls += 1;
      disarm();
      try {
        return await driver.run(request, call);
      } finally {
        state.calls -= 1;
        arm();
      }
    },
    stop: async () => {
      disarm();
      await driver.stop();
    },
    isRunning: () => driver.isRunning(),
  };
}
