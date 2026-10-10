import { BinferenceError, type Clock, err, ok, type Random } from "@binference/core";
import type { AccessStore } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { checkBotToken, issueStartCode } from "@binference/telegram";
import type { Api } from "grammy";

/** How long a start code from `binference telegram pair` works: 10 minutes (decision 0139). */
export const pairingLifetimeMs: number = 10 * 60 * 1000;

/** What `telegram/pair` reads and writes. */
export interface TelegramPairOptions {
  /** The owner's bot, or `undefined` when the engine runs without it. */
  readonly api: Api | undefined;
  /** Keeps the start code's hash until it is used. */
  readonly access: AccessStore;
  readonly clock: Clock;
  readonly random: Random;
}

// The bot's username from Telegram; a Bot API call that fails says Telegram did not answer.
async function botUsernameOf(api: Api, signal: AbortSignal) {
  try {
    const bot = await checkBotToken(api, { signal });
    return bot.ok ? ok(bot.value.username) : err("telegram.not_running" as const);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof BinferenceError && error.code.startsWith("telegram.")) {
      return err("telegram.unreachable" as const);
    }
    throw error;
  }
}

/**
 * The handler of `telegram/pair`: a new single-use start code for the owner's bot, valid
 * {@link pairingLifetimeMs}, whose link the caller shows once. Only the code's hash is stored, and
 * the current owner stays until someone opens the link (decision 0139). Fails
 * `telegram.not_running` while the engine runs without the bot, or Telegram refuses its token,
 * and `telegram.unreachable` when Telegram does not answer.
 */
export function createTelegramPair(options: TelegramPairOptions): EngineHandlerTable {
  return {
    "telegram/pair": async ({ signal }) => {
      if (options.api === undefined) {
        return err("telegram.not_running");
      }
      const username = await botUsernameOf(options.api, signal);
      if (!username.ok) {
        return username;
      }
      const { access, clock, random } = options;
      const code = await issueStartCode(
        { access, clock, random, botUsername: username.value, lifetimeMs: pairingLifetimeMs },
        { signal },
      );
      return ok({ link: code.link.reveal(), expiresAt: code.expiresAtMs });
    },
  };
}
