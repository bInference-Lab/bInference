import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface WebhookFillTimerOptions {
  /** The engine's webhook rule fills, which fill the alerts the listener accepted. */
  readonly fillWebhookAlerts: Engine["fillWebhookAlerts"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// An alert fills only within a minute of its arrival (decision 0336), so the fills run every
// second.
const fillEveryMs = 1_000;

/**
 * Runs the engine's webhook rule fills every second while it serves, locked or not: a locked
 * engine's alerts skip with `engine_locked`, so the owner hears of each one it could not fill. A
 * failure is logged as `engine.webhook_fills_failed` and tried again a second later.
 */
export function startWebhookFillTimer(options: WebhookFillTimerOptions): void {
  const { fillWebhookAlerts, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    name: "webhook_fills",
    run: fillWebhookAlerts,
    everyMs: fillEveryMs,
    failedEvent: "engine.webhook_fills_failed",
    isLocked: () => false,
  });
}
