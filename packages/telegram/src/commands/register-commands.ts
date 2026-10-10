import { createFormatter, type MessageLocale } from "@binference/i18n";
import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";
import { fastCommandNames } from "./command-of.js";

/** One fast command of the bot's menu, in one language. */
export interface MenuCommand {
  readonly command: string;
  readonly description: string;
}

// The menu in each language Telegram shows it for: Chinese to an app set to Chinese, English to
// every other. Telegram takes a two-letter language code.
const menuLanguages: readonly { readonly locale: MessageLocale; readonly code?: "zh" }[] = [
  { locale: "en" },
  { locale: "zh", code: "zh" },
];

// The bot answers only the owner's private chat, so its menu shows only in private chats.
const privateChats = { type: "all_private_chats" } as const;

/** The fast commands' menu in a language: each command with its line of `cmd.menu.*`. */
export function menuOf(locale: MessageLocale): readonly MenuCommand[] {
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  return fastCommandNames.map((command) => ({
    command,
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    description: formatter.message(`cmd.menu.${command}`),
  }));
}

/**
 * Registers the fast commands' menu with Telegram through `setMyCommands`, in private chats: in
 * English for every language, and in Chinese for a Telegram app set to Chinese (spec 4, section
 * 5). Setting it again replaces it.
 */
export async function registerCommands(
  api: Api,
  options: { readonly signal: AbortSignal },
): Promise<void> {
  await Promise.all(
    menuLanguages.map(async (language) => {
      const other = {
        scope: privateChats,
        ...(language.code === undefined ? {} : { language_code: language.code }),
      };
      await callBotApi("setMyCommands", options.signal, async (signal) =>
        api.setMyCommands(menuOf(language.locale), other, signal),
      );
    }),
  );
}
