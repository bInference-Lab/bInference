import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * The most notices one alert sends in its hour (owner's choice, 2026-10-19, decision 0245): past
 * them its matches are counted, and the owner hears the count in one line when the hour ends.
 */
const maxAlertNoticesPerHour = 5;

/** How long an alert's notice hour lasts, from its first notice. */
export const alertNoticeWindowMs = 3_600_000;

/** An alert's notice hour: when it began, the notices it sent and the matches it held back. */
export interface AlertNoticeWindow {
  readonly startedAtMs: number;
  readonly sent: number;
  readonly held: number;
}

/** Parses a notice hour. */
export const alertNoticeWindowSchema: z.ZodType<AlertNoticeWindow> = z.strictObject({
  startedAtMs: epochMsSchema,
  sent: z.int().nonnegative(),
  held: z.int().nonnegative(),
});

/** What one fire does with its alert's notice hour. */
export interface NoticeOfFire {
  readonly window: AlertNoticeWindow;
  /** Whether the fire's notice goes out. */
  readonly notify: boolean;
  /** The matches the hour before held back and no summary told yet, which this fire tells. */
  readonly heldBefore: number;
}

/**
 * A fire at `atMs` against its alert's notice hour: a fire after the hour ends begins a new one
 * and tells the matches the old one held back; within the hour, the first five fires notify and
 * the rest are counted.
 */
export function noticeOfFire(window: AlertNoticeWindow | undefined, atMs: number): NoticeOfFire {
  if (window === undefined || atMs >= window.startedAtMs + alertNoticeWindowMs) {
    return {
      window: { startedAtMs: atMs, sent: 1, held: 0 },
      notify: true,
      heldBefore: window?.held ?? 0,
    };
  }
  return window.sent < maxAlertNoticesPerHour
    ? { window: { ...window, sent: window.sent + 1 }, notify: true, heldBefore: 0 }
    : { window: { ...window, held: window.held + 1 }, notify: false, heldBefore: 0 };
}

/** Whether a notice hour ended by `atMs` with matches held back that no line told yet. */
export function hasHeldToTell(window: AlertNoticeWindow | undefined, atMs: number): boolean {
  return (
    window !== undefined && window.held > 0 && atMs >= window.startedAtMs + alertNoticeWindowMs
  );
}
