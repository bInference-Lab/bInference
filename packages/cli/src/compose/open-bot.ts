import { BinferenceError, type Clock, type Http, type Logger, type Secret } from "@binference/core";
import type { EngineStores } from "@binference/engine";
import { createBotApiFetch, createBotThrottlers } from "@binference/telegram";
import { Api } from "grammy";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import type { TelegramParts } from "./compose-telegram.js";

/** The owner's bot as `binference start` opens it. */
export interface OpenedBot {
  /** The bot token, which reaches only grammY, the poll worker and the Mini App's sign-in. */
  readonly token: Secret;
  /**
   * Its grammY `Api` with the token's throttler installed. Its owner and card copies live in
   * `engine.sqlite` (decision 0139), with the engine's other stores.
   */
  readonly api: Api;
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
 * with the token's throttler installed. A token that cannot be read is
 * logged as `telegram.bot_skipped` with its code, and the engine starts without the bot: the CLI
 * and the console still answer, and notices stay in the store.
 */
export async function openBot(options: OpenBotOptions): Promise<OpenedBot | undefined> {
  const { secrets, logger, signal } = options;
  try {
    const token = await secrets.read("telegram.botToken", options.source, signal);
    const api = new Api(token.reveal(), { fetch: createBotApiFetch(options.http) });
    createBotThrottlers({ clock: options.clock, logger }).install(api);
    return { token, api };
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    logger.error("telegram.bot_skipped", { errorCode });
    return undefined;
  }
}

/**
 * The bot as the engine serves it: its `Api` and token, and the owner, the card copies and the
 * agents' topics `engine.sqlite` keeps, so a pairing, the cards' copies and each agent's topic
 * outlast a restart (decisions 0139 and 0186). `topicsOn` reads `telegram.topicsPerAgent` as it
 * is now.
 */
export function botParts(
  bot: OpenedBot,
  stores: Pick<EngineStores, "owners" | "cardCopies" | "agentTopics">,
  topicsOn: () => boolean,
): TelegramParts {
  return {
    api: bot.api,
    owners: stores.owners,
    copies: stores.cardCopies,
    topics: { isOn: topicsOn, store: stores.agentTopics },
    botToken: bot.token,
  };
}
