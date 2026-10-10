import type { ChainRegistry } from "@binference/chain";
import { BinferenceError, type Logger } from "@binference/core";
import type { MessageLocale, MessageValues } from "@binference/i18n";
import type { Api } from "grammy";
import type { CardShowing, TelegramCards } from "../cards/create-telegram-cards.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { createBotCalls } from "../ingress/bot-calls.js";
import type { ReplyTarget } from "../ingress/decide-update.js";
import type { OwnerCalls } from "../ports.js";
import type { ChatPost } from "../updates/chat-update.schema.js";
import { runLimits, runPaper } from "./agent-commands.js";
import type { CommandContext, CommandRun } from "./command-context.js";
import { commandOf, type FastCommandName, fastCommandNames } from "./command-of.js";
import { runOrders } from "./orders-command.js";
import { runBalance, runPositions } from "./portfolio-commands.js";
import { registerCommands } from "./register-commands.js";
import { runCancel, runFreeze, runRescue } from "./safety-commands.js";
import { runStatus } from "./status-command.js";

/** The owner's fast commands in Telegram: answered by the engine's code, never by a model. */
export interface FastCommands {
  /**
   * Answers the owner's post when it is a fast command the owner typed, and resolves `true` once
   * the reply is sent; resolves `false` for any other post, which it leaves alone. A refusal is
   * answered with its error message; a fault Telegram may get over rejects, so the update is
   * handled again.
   */
  answer(post: ChatPost, options: { readonly signal: AbortSignal }): Promise<boolean>;
  /** Registers the commands' menu in English and Chinese with `setMyCommands`. */
  register(options: { readonly signal: AbortSignal }): Promise<void>;
}

/** What {@link createFastCommands} needs. */
export interface FastCommandsOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** The engine's side: runs each operation for the owner alone. */
  readonly calls: OwnerCalls;
  readonly cards: TelegramCards;
  /** The cards that wait for the owner's answer, oldest first (`CardShowings.waiting`). */
  readonly waiting: (options: { readonly signal: AbortSignal }) => Promise<readonly CardShowing[]>;
  readonly chains: ChainRegistry;
  /** The owner's language and timezone as they are now, read for each command. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
  readonly logger: Logger;
}

async function runHelp(context: CommandContext): Promise<void> {
  const lines = fastCommandNames.map((command) =>
    context.words("cmd.help.item", { command, description: context.words(`cmd.menu.${command}`) }),
  );
  await context.say([context.words("cmd.help.heading"), ...lines].join("\n"));
}

async function runLang(context: CommandContext): Promise<void> {
  await context.say(context.words("cmd.lang.current", { locale: context.formatter.locale }));
}

const runs: Readonly<Record<FastCommandName, CommandRun>> = {
  balance: runBalance,
  positions: runPositions,
  orders: runOrders,
  cancel: runCancel,
  freeze: runFreeze,
  rescue: runRescue,
  paper: runPaper,
  status: runStatus,
  limits: runLimits,
  lang: runLang,
  help: runHelp,
};

function targetOf(post: ChatPost): ReplyTarget {
  return {
    chatId: post.chatId,
    ...(post.threadId === undefined ? {} : { threadId: post.threadId }),
  };
}

// A fault Telegram or the store may get over leaves the update for the next pass; any other is
// logged by its code and answered with the internal error's message.
async function runCaught(run: CommandRun, context: CommandContext, logger: Logger): Promise<void> {
  try {
    await run(context);
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof BinferenceError && error.retryable) {
      throw error;
    }
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    logger.error("telegram.command_failed", { errorCode });
    await context.say(context.words("error.internal.error"));
  }
}

/**
 * Creates the owner's fast commands (spec 4, section 5). Each runs the engine's operations as the
 * owner on Telegram through `calls` and answers in the chat it came from, in the owner's language,
 * split at line breaks into messages Telegram takes. No command reaches the agent's model.
 */
export function createFastCommands(options: FastCommandsOptions): FastCommands {
  const { calls, cards, waiting, chains, logger } = options;
  const bot = createBotCalls(options.api);
  const formatters = createOwnerFormatters();
  return {
    async answer(post, { signal }) {
      const command = commandOf(post);
      const senderId = post.sender?.id;
      if (command === undefined || senderId === undefined) {
        return false;
      }
      const formatter = formatters(options.display());
      const target = targetOf(post);
      const context: CommandContext = {
        calls,
        cards,
        waiting,
        chains,
        formatter,
        // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
        words: (key: string, values?: MessageValues) => formatter.message(key, values),
        senderId,
        signal,
        say: async (text, sayOptions) => bot.say(target, text, { signal, ...sayOptions }),
      };
      await runCaught(runs[command], context, logger);
      return true;
    },
    register: async ({ signal }) => registerCommands(options.api, { signal }),
  };
}
