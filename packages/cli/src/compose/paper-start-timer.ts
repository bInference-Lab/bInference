import type { Clock, Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

/** What the timer runs, and what it runs on. */
export interface PaperStartTimerOptions {
  /** The engine's start of each paper portfolio never started (decision 0450). */
  readonly startPaper: Engine["startPaper"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A pass reads nothing for an agent it is done with, so a pass each minute costs one read of the
// agents and the wallets once every agent has its paper portfolio.
const paperStartEveryMs = 60_000;

/**
 * Starts each agent's paper portfolio that was never started at once while the engine serves,
 * then every minute, locked or not: a paper portfolio needs no key. An agent added later, and one
 * whose start found no price, get theirs on a later pass. Each start is logged as
 * `engine.paper_started`, and each agent still without one as `engine.paper_start_waits`, by the
 * agent's id; a failure is logged as `engine.paper_start_failed` and tried again a minute later.
 * Its closer stops it.
 */
export function startPaperStartTimer(options: PaperStartTimerOptions): void {
  const { startPaper, logger, ...rest } = options;
  startRepeatingTimer({
    ...rest,
    logger,
    name: "paper start",
    run: async (call) => {
      const pass = await startPaper(call);
      pass.started.forEach((agentId) => logger.info("engine.paper_started", { agentId }));
      pass.waiting.forEach((agentId) => logger.warn("engine.paper_start_waits", { agentId }));
    },
    everyMs: paperStartEveryMs,
    firstAfterMs: 0,
    failedEvent: "engine.paper_start_failed",
    isLocked: () => false,
  });
}
