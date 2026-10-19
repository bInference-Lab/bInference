import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * The most notices one alert, or one copy order's skips, sends in its hour (owner's choice,
 * 2026-10-19, decision 0245): past them the rest are counted, and the owner hears the count in one
 * line when the hour ends.
 */
const maxNoticesPerHour = 5;

/** How long a notice hour lasts, from its first notice. */
export const noticeHourMs = 3_600_000;

/** A notice hour: when it began, the notices it sent and the ones it held back. */
export interface NoticeHour {
  readonly startedAtMs: number;
  readonly sent: number;
  readonly held: number;
}

/** Parses a notice hour. */
export const noticeHourSchema: z.ZodType<NoticeHour> = z.strictObject({
  startedAtMs: epochMsSchema,
  sent: z.int().nonnegative(),
  held: z.int().nonnegative(),
});

/** What one notice does with its notice hour. */
export interface CountedNotice {
  readonly window: NoticeHour;
  /** Whether the notice goes out. */
  readonly notify: boolean;
  /** The notices the hour before held back and no summary told yet, which this one tells. */
  readonly heldBefore: number;
}

/**
 * A notice at `atMs` against its notice hour: one after the hour ends begins a new hour and tells
 * what the old one held back; within the hour, the first five notify and the rest are counted.
 */
export function countNotice(window: NoticeHour | undefined, atMs: number): CountedNotice {
  if (window === undefined || atMs >= window.startedAtMs + noticeHourMs) {
    return {
      window: { startedAtMs: atMs, sent: 1, held: 0 },
      notify: true,
      heldBefore: window?.held ?? 0,
    };
  }
  return window.sent < maxNoticesPerHour
    ? { window: { ...window, sent: window.sent + 1 }, notify: true, heldBefore: 0 }
    : { window: { ...window, held: window.held + 1 }, notify: false, heldBefore: 0 };
}

/** Whether a notice hour ended by `atMs` with notices held back that no line told yet. */
export function hasHeldToTell(window: NoticeHour | undefined, atMs: number): boolean {
  return window !== undefined && window.held > 0 && atMs >= window.startedAtMs + noticeHourMs;
}
