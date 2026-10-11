import { BinferenceError } from "@binference/core";

/** What a wall clock in one timezone shows at a moment. */
export interface WallClock {
  readonly year: number;
  /** 1 for January to 12 for December. */
  readonly month: number;
  readonly day: number;
  /** 0 to 23. */
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 0 for Sunday to 6 for Saturday. */
  readonly weekday: number;
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatIn(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch (error) {
    throw new BinferenceError({
      code: "i18n.bad_time_zone",
      message: `${timeZone} is not a timezone Intl knows, such as Asia/Shanghai.`,
      cause: error,
      details: { timeZone },
    });
  }
}

/**
 * The date and time a wall clock in `timeZone`, an IANA zone such as `Asia/Shanghai`, shows at
 * `atMs`, for rules that run on the owner's time, such as the nightly backup. Throws
 * `i18n.bad_time_zone` for a zone Intl does not know.
 */
export function wallClockOf(atMs: number, timeZone: string): WallClock {
  const parts = new Map<string, string>(
    formatIn(timeZone)
      .formatToParts(atMs)
      .map((part: Readonly<Intl.DateTimeFormatPart>) => [part.type, part.value]),
  );
  const number = (name: string): number => Number(parts.get(name) ?? 0);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
    weekday: weekdays.indexOf(parts.get("weekday") ?? ""),
  };
}
