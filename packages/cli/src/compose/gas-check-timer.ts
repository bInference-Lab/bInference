import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface GasCheckTimerOptions {
  /** The engine's gas check, which raises the low-gas alert. */
  readonly checkGas: Engine["checkGas"];
  /** A locked engine signs nothing, so its own trades spend no gas until its keys open. */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A wallet below twice its reserve still holds gas for hundreds of swaps; a minute late is
// nothing next to that, and one balance read per live wallet a minute stays far inside a public
// RPC's limits.
const gasCheckEveryMs = 60_000;

/**
 * Runs the engine's gas check every minute while it serves, in the startup order's place for
 * orders and watchers, so a wallet that runs low between two proposals, such as after a trade's
 * fee or a send from outside, raises the low-gas alert (decision 0045). A locked engine skips it;
 * a failure is logged as `engine.gas_check_failed` and tried again a minute later.
 */
export function startGasCheckTimer(options: GasCheckTimerOptions): void {
  const { checkGas, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "gas check",
    run: checkGas,
    everyMs: gasCheckEveryMs,
    failedEvent: "engine.gas_check_failed",
  });
}
