import { BinferenceError, type Clock, type Http, type Logger, type Secret } from "@binference/core";
import { createBotApiFetch, createBotThrottlers } from "@binference/telegram";
import { Api } from "grammy";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import type { TelegramParts } from "./compose-telegram.js";
import { createRunBotStores } from "./run-bot-stores.js";

/** The owner's bot as `binference start` opens it. */
export interface OpenedBot {
  /** The bot token, which reaches only grammY and the poll worker. */
  readonly token: Secret;
  /** Its grammY `Api` with the token's throttler installed, and its stores. */
  readonly parts: TelegramParts;
}

/** What the bot opens with. */
export interface OpenBotOptions {
  /** config.json5's `telegram.botToken`. */
  readonly source: SecretSource;
  readonly secrets: SecretReader;
  /** binference's outbound HTTP, which every Bot API request goes through. */
  readonly http: Http;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly signal: AbortSignal;
}

/**
 * Opens the owner's bot from `telegram.botToken`: grammY's `Api` over binference's outbound HTTP,
 * with the token's throttler installed, and the bot's stores. A token that cannot be read is
 * logged as `telegram.bot_skipped` with its code, and the engine starts without the bot: the CLI
 * and the console still answer, and notices stay in the store.
 */
export async function openBot(options: OpenBotOptions): Promise<OpenedBot | undefined> {
  const { secrets, logger, signal } = options;
  try {
    const token = await secrets.read("telegram.botToken", options.source, signal);
    const api = new Api(token.reveal(), { fetch: createBotApiFetch(options.http) });
    createBotThrottlers({ clock: options.clock, logger }).install(api);
    return { token, parts: { api, ...createRunBotStores() } };
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    logger.error("telegram.bot_skipped", { errorCode });
    return undefined;
  }
}
