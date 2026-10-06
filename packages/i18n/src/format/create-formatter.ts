import type { Bps } from "@binference/core";
import type { MessageLocale } from "../locales.js";
import { formatPercent, formatTokenAmount, formatUsd } from "./format-amount.js";
import { createTimeFormats } from "./format-time.js";

/** Whom a formatter writes for: the owner's language and IANA timezone. */
export interface FormatterOptions {
  readonly locale: MessageLocale;
  /** An IANA timezone such as `Asia/Shanghai`, from the owner's settings. */
  readonly timeZone: string;
}

/**
 * The one formatter every surface uses for amounts and times. Numbers and money read the same in
 * both languages (`$1.20`, `0.005 BNB`); dates follow the language.
 */
export interface Formatter {
  readonly locale: MessageLocale;
  /** A token amount from base units and the token's decimals, to 6 significant digits. */
  readonly tokenAmount: (amountBase: bigint, decimals: number) => string;
  /** A USD value from micro-dollars, with 2 decimals; `<$0.01` under a cent. */
  readonly usd: (usdMicros: bigint) => string;
  /** A rate in basis points as a percentage with 2 decimals. */
  readonly percent: (rate: Bps) => string;
  /** The time of day, `HH:mm:ss`, in the owner's timezone. */
  readonly time: (epochMs: number) => string;
  /** The day in the owner's timezone, in the language's own form. */
  readonly date: (epochMs: number) => string;
  /** The day and the time of day together. */
  readonly dateTime: (epochMs: number) => string;
}

/**
 * Builds the formatter for one owner. Throws `i18n.bad_time_zone` when `Intl` does not know the
 * timezone.
 */
export function createFormatter(options: FormatterOptions): Formatter {
  const times = createTimeFormats(options.locale, options.timeZone);
  return {
    locale: options.locale,
    tokenAmount: formatTokenAmount,
    usd: formatUsd,
    percent: formatPercent,
    ...times,
  };
}
