import { BinferenceError } from "@binference/core";
import { IntlMessageFormat } from "intl-messageformat";
import { intlTags, type MessageLocale } from "../locales.js";
import { messages } from "../messages.js";

/** The values of a message's arguments: text already formatted, or a number for plurals. */
export type MessageValues = Readonly<Record<string, string | number>>;

/** Formats the message under a key with its values. */
export type MessageFormat = (key: string, values?: MessageValues) => string;

/**
 * Builds the message formatter of one language. Each message is compiled once, on first use.
 * Throws `i18n.unknown_message` for a key no file holds, and `i18n.bad_values` when the values
 * leave out an argument or do not fit it.
 */
export function createMessageFormat(locale: MessageLocale): MessageFormat {
  const catalog = messages[locale];
  // One entry per key at most, so the cache never grows past the catalog.
  const compiled = new Map<string, IntlMessageFormat>();
  return (key, values) => {
    const text = catalog[key];
    if (text === undefined) {
      throw new BinferenceError({
        code: "i18n.unknown_message",
        message: `No ${locale} message has the key ${key}.`,
        details: { key },
      });
    }
    const format = compiled.get(key) ?? new IntlMessageFormat(text, intlTags[locale]);
    compiled.set(key, format);
    try {
      const result = format.format<string>(values);
      return typeof result === "string" ? result : result.join("");
    } catch (error) {
      throw new BinferenceError({
        code: "i18n.bad_values",
        message: `The values do not fit the ${locale} message ${key}.`,
        cause: error,
        details: { key },
      });
    }
  };
}
