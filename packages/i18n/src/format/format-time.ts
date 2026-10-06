import { BinferenceError } from "@binference/core";
import { intlTags, type MessageLocale } from "../locales.js";

/** Formats moments in one language and the owner's timezone. */
export interface TimeFormats {
  /** `14:32:05`, the 24-hour clock in both languages; expiries use it. */
  readonly time: (epochMs: number) => string;
  /** The day in the language's own form: `Oct 6, 2026` in English. */
  readonly date: (epochMs: number) => string;
  /** The day and the 24-hour time together. */
  readonly dateTime: (epochMs: number) => string;
}

function dateTimeFormat(
  locale: MessageLocale,
  timeZone: string,
  options: Readonly<Intl.DateTimeFormatOptions>,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(intlTags[locale], { ...options, timeZone });
  } catch (error) {
    throw new BinferenceError({
      code: "i18n.bad_time_zone",
      message: `${timeZone} is not a timezone Intl knows, such as Asia/Shanghai.`,
      cause: error,
    });
  }
}

function checkedTime(epochMs: number): number {
  if (!Number.isFinite(epochMs)) {
    throw new BinferenceError({
      code: "i18n.bad_time",
      message: `A time must be epoch milliseconds, not ${String(epochMs)}.`,
    });
  }
  return epochMs;
}

/**
 * Builds the time formats of one language in one IANA timezone. Throws `i18n.bad_time_zone` for
 * a timezone `Intl` does not know; each format throws `i18n.bad_time` for a time that is not a
 * finite number.
 */
export function createTimeFormats(locale: MessageLocale, timeZone: string): TimeFormats {
  const clock = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  } as const;
  const time = dateTimeFormat(locale, timeZone, clock);
  const date = dateTimeFormat(locale, timeZone, { dateStyle: "medium" });
  const dateTime = dateTimeFormat(locale, timeZone, {
    dateStyle: "medium",
    timeStyle: "medium",
    hourCycle: "h23",
  });
  return {
    time: (epochMs) => time.format(checkedTime(epochMs)),
    date: (epochMs) => date.format(checkedTime(epochMs)),
    dateTime: (epochMs) => dateTime.format(checkedTime(epochMs)),
  };
}
