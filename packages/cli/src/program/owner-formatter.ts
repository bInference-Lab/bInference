import { createFormatter, type Formatter } from "@binference/i18n";
import type { Locale } from "@binference/protocol";

/** The formatter in the owner's language and zone; UTC when the zone is one `Intl` does not know. */
export function ownerFormatter(owner: {
  readonly locale: Locale;
  readonly timezone: string;
}): Formatter {
  try {
    return createFormatter({ locale: owner.locale, timeZone: owner.timezone });
  } catch {
    return createFormatter({ locale: owner.locale, timeZone: "UTC" });
  }
}
