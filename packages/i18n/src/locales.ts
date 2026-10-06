/**
 * A language binference ships every message in: English or Simplified Chinese. It equals the
 * protocol's `Locale`.
 */
export type MessageLocale = "en" | "zh";

/** Every language binference speaks, English first: English is the source of every message. */
export const messageLocales: readonly MessageLocale[] = ["en", "zh"];

/** The BCP 47 tag that `Intl` and ICU plural rules use for each language. */
export const intlTags: Readonly<Record<MessageLocale, string>> = { en: "en-US", zh: "zh-CN" };
