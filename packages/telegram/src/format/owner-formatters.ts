import { createFormatter, type Formatter, type FormatterOptions } from "@binference/i18n";

/** Formatters by language and timezone, built once each. */
export type OwnerFormatters = (options: FormatterOptions) => Formatter;

// Two languages and the owner's timezone, with room for a timezone the owner changes to; the
// oldest formatter leaves first.
const maxFormatters = 4;

/**
 * Gives the formatter for a language and timezone, building it on first use. The bot reads the
 * owner's language and timezone on each message, so a change of `owner.locale` or
 * `owner.timezone` in config.json5 applies to the next one.
 */
export function createOwnerFormatters(): OwnerFormatters {
  const built = new Map<string, Formatter>();
  return (options) => {
    const key = `${options.locale} ${options.timeZone}`;
    const known = built.get(key);
    if (known !== undefined) {
      return known;
    }
    const formatter = createFormatter(options);
    if (built.size >= maxFormatters) {
      built.delete(built.keys().next().value ?? key);
    }
    built.set(key, formatter);
    return formatter;
  };
}
