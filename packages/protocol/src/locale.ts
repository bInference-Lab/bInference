import { z } from "zod";

const locales = ["en", "zh"] as const;

/** A language binference ships every message in: English or Simplified Chinese. */
export type Locale = (typeof locales)[number];

/** Parses a locale, `en` or `zh`. */
export const localeSchema: z.ZodType<Locale, string> = z.enum(locales);
