import type { ChainRegistry } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { type Notice, noticeText } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import type { Api } from "grammy";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { createBotCalls } from "../ingress/bot-calls.js";
import type { OwnerStore } from "../ports.js";

/** The engine's notices in the owner's Telegram chat. */
export interface TelegramNotices {
  /**
   * Sends a notice to the owner's chat as plain text in the owner's language, split at line breaks
   * into messages Telegram takes. `no_owner` before an owner is bound. A Bot API fault rejects;
   * the bot's throttler has waited out any 429 by then.
   */
  send(
    notice: Notice,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<void, "no_owner">>;
}

/** What {@link createTelegramNotices} needs. */
export interface TelegramNoticesOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  readonly owners: OwnerStore;
  /** The chains whose coins and tokens a notice's amounts name. */
  readonly chains: ChainRegistry;
  /** The owner's language and timezone as they are now, read for each notice. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
}

/**
 * Creates the notices of the owner's chat (spec 4, section 4): each is written by the engine's
 * `noticeText`, in the owner's language and timezone, and sent with no parse mode, so no value in
 * it can format the message.
 */
export function createTelegramNotices(options: TelegramNoticesOptions): TelegramNotices {
  const bot = createBotCalls(options.api);
  const formatters = createOwnerFormatters();
  return {
    async send(notice, { signal }) {
      const owner = await options.owners.get({ signal });
      if (owner === undefined) {
        return err("no_owner");
      }
      const display = { formatter: formatters(options.display()), chains: options.chains };
      await bot.say({ chatId: owner.userId }, noticeText(notice, display), { signal });
      return ok(undefined);
    },
  };
}
