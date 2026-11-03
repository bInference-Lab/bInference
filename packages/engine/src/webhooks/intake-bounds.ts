import type { Clock } from "@binference/core";

/** How many rule reads the webhook intake makes in any second; past it, a request is a 404. */
export const webhookReadsPerSecond = 50;

/** The refused alerts a rule may record in a minute, as a multiple of its rate. */
export const webhookRefusalRowsPerRate = 10;

/** How many rules the intake keeps a refusal count for; past it, the oldest count goes. */
export const webhookRefusalRulesKept = 1_024;

const minuteMs = 60_000;

/**
 * A budget of rule reads, refilled at `webhookReadsPerSecond`: a stranger who sends well-formed
 * rule ids as fast as the listener answers drives at most that many reads of the store the money
 * path reads too.
 */
export interface ReadBudget {
  /** Takes one read if the budget holds one. */
  take(): boolean;
}

/** Creates a {@link ReadBudget}, full at its start. */
export function createReadBudget(clock: Clock): ReadBudget {
  let tokens = webhookReadsPerSecond;
  let refilledAtMs = clock.now();
  return {
    take() {
      const nowMs = clock.now();
      const earned = ((nowMs - refilledAtMs) * webhookReadsPerSecond) / 1_000;
      tokens = Math.min(webhookReadsPerSecond, tokens + Math.max(0, earned));
      refilledAtMs = nowMs;
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}

interface RefusalWindow {
  readonly startMs: number;
  readonly recorded: number;
}

/**
 * Each rule's refused alerts recorded in the minute that began with its first one. A leaked URL
 * sent the same body without end records `webhookRefusalRowsPerRate` times the rule's rate a
 * minute, enough to show the owner what happened; past it, the intake answers 429 without a
 * write until the minute ends. It keeps at most `webhookRefusalRulesKept` rules, dropping the
 * one counted longest ago.
 */
export interface RefusalCounts {
  /** Whether the rule has recorded its refusals for this minute. */
  isFull(rule: string, ratePerMinute: number): boolean;
  /** Counts one refusal the store recorded for the rule. */
  count(rule: string): void;
}

/** Creates empty {@link RefusalCounts}. */
export function createRefusalCounts(clock: Clock): RefusalCounts {
  const windows = new Map<string, RefusalWindow>();
  const current = (rule: string): RefusalWindow | undefined => {
    const window = windows.get(rule);
    return window !== undefined && clock.now() < window.startMs + minuteMs ? window : undefined;
  };
  return {
    isFull(rule, ratePerMinute) {
      const window = current(rule);
      return window !== undefined && window.recorded >= ratePerMinute * webhookRefusalRowsPerRate;
    },
    count(rule) {
      const window = current(rule) ?? { startMs: clock.now(), recorded: 0 };
      windows.delete(rule);
      windows.set(rule, { ...window, recorded: window.recorded + 1 });
      const oldest = windows.keys().next();
      if (windows.size > webhookRefusalRulesKept && oldest.done !== true) {
        windows.delete(oldest.value);
      }
    },
  };
}
