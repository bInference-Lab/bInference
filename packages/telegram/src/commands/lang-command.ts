import { type MessageLocale, messageLocales } from "@binference/i18n";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { commandCallbackData } from "./command-callback.schema.js";
import { callOrSay, type CommandContext, type PressContext } from "./command-context.js";

// One button per language, each named in itself, so the owner finds theirs whatever binference
// speaks now.
function buttonsOf(context: CommandContext): ButtonRows {
  return [
    messageLocales.map((locale) => ({
      text: context.words(`language.${locale}`),
      data: commandCallbackData({ kind: "language", locale }),
    })),
  ];
}

/** `/lang`: the language binference uses with the owner, and a button for each language. */
export async function runLang(context: CommandContext): Promise<void> {
  const text = context.words("cmd.lang.current", { locale: context.formatter.locale });
  await context.say(text, { buttons: buttonsOf(context) });
}

/**
 * A press of a `/lang` button: sets `owner.locale` through `config/change`, the one setting the
 * owner's chat changes (decision 0134), and answers in the new language; the live reload of
 * config.json5 then applies it, journals it and announces it. The language in use changes
 * nothing.
 */
export async function runLanguage(context: PressContext, locale: MessageLocale): Promise<void> {
  if (locale !== context.formatter.locale) {
    const patch = { owner: { locale } };
    if ((await callOrSay(context, "config/change", { patch })) === undefined) {
      await context.answer();
      return;
    }
  }
  const words = context.wordsIn(locale);
  await context.edit(words("cmd.lang.current", { locale }), buttonsOf(context));
  await context.answer(words("cmd.lang.switched", { locale }));
}
