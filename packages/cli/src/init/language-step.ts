import { messageLocales } from "@binference/i18n";
import { type Locale, localeSchema } from "@binference/protocol";
import { systemLocale } from "../program/system-defaults.js";
import type { InitContext } from "./init-context.js";
import { isSetByFlag } from "./set-by-flag.js";

/**
 * The language step, first in the onboarding (ARCHITECTURE section 27): the person picks the
 * language every later question and every surface speaks, the earlier set-up's or the system's
 * first. Answers nothing when nobody answers or a `--set owner.locale` flag gives it: the config
 * then takes the flag's or the system's.
 */
export async function takeLanguage(
  context: InitContext,
  earlier: Locale | undefined,
): Promise<Locale | undefined> {
  if (!context.isInteractive || isSetByFlag(context, ["owner", "locale"])) {
    return undefined;
  }
  const picked = await context.prompter.choose({
    id: "language",
    message: context.words("language.ask"),
    options: messageLocales.map((locale) => ({
      value: locale,
      label: context.message(`language.${locale}`),
    })),
    initial: earlier ?? systemLocale(context.host.env),
  });
  return localeSchema.parse(picked);
}
