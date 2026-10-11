import type { ChainRegistry } from "@binference/chain";
import { BinferenceError, type Logger } from "@binference/core";
import type { MessageLocale, MessageValues } from "@binference/i18n";
import type { Api } from "grammy";
import type { CardShowing, TelegramCards } from "../cards/create-telegram-cards.js";
import { createOwnerFormatters, type OwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import type { ReplyTarget } from "../ingress/decide-update.js";
import type { OwnerCalls } from "../ports.js";
import type { ButtonPress, ChatPost } from "../updates/chat-update.schema.js";
import { runHalve, runLimits, runPaper } from "./agent-commands.js";
import { commandCallbackSchema } from "./command-callback.schema.js";
import type { CommandContext, CommandRun, PressContext } from "./command-context.js";
import { commandOf, type FastCommandName, fastCommandNames } from "./command-of.js";
import { runConsole } from "./console-command.js";
import { runLang, runLanguage } from "./lang-command.js";
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
  /**
   * Takes the owner's press of a fast command's button, such as a `/limits` button that halves a
   * limit, and resolves `true` once it is answered; resolves `false` for data in any other form,
   * such as a card button's, which it leaves alone.
   */
  press(press: ButtonPress, options: { readonly signal: AbortSignal }): Promise<boolean>;
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
  /**
   * The Mini App's address, `/mini` on the HTTPS origin the owner publishes the engine's port at;
   * without one, `/console` says how to set it.
   */
  readonly miniAppUrl?: string;
  readonly logger: Logger;
}

async function runHelp(context: CommandContext): Promise<void> {
  const lines = fastCommandNames.map((command) =>
    context.words("cmd.help.item", { command, description: context.words(`cmd.menu.${command}`) }),
  );
  await context.say([context.words("cmd.help.heading"), ...lines].join("\n"));
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
  console: runConsole,
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

/** Where a command answers: the chat and topic, and who asked. */
interface Asker {
  readonly target: ReplyTarget;
  readonly senderId: number;
  readonly signal: AbortSignal;
}

/** What every command's context is made from: the options, the bot's calls and the formatters. */
interface Parts {
  readonly options: FastCommandsOptions;
  readonly bot: BotCalls;
  readonly formatters: OwnerFormatters;
}

function contextOf(parts: Parts, asker: Asker): CommandContext {
  const { options, bot } = parts;
  const { calls, cards, waiting, chains } = options;
  const formatter = parts.formatters(options.display());
  const { target, senderId, signal } = asker;
  return {
    calls,
    cards,
    waiting,
    chains,
    formatter,
    // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
    words: (key: string, values?: MessageValues) => formatter.message(key, values),
    senderId,
    ...(options.miniAppUrl === undefined ? {} : { miniAppUrl: options.miniAppUrl }),
    signal,
    say: async (text, sayOptions) => bot.say(target, text, { signal, ...sayOptions }),
  };
}

function pressContextOf(
  parts: Parts,
  pressed: { readonly press: ButtonPress; readonly chatId: number; readonly messageId: number },
  signal: AbortSignal,
): PressContext {
  const { bot } = parts;
  const { press, chatId, messageId } = pressed;
  const asker = { target: { chatId }, senderId: press.sender.id, signal };
  return {
    ...contextOf(parts, asker),
    edit: async (text, buttons) => bot.edit({ chatId, messageId }, text, { signal, buttons }),
    answer: async (notice) => bot.answer(press.callbackId, notice, { signal }),
    wordsIn: (locale) => {
      const formatter = parts.formatters({ ...parts.options.display(), locale });
      // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
      return (key, values) => formatter.message(key, values);
    },
  };
}

/**
 * Creates the owner's fast commands (spec 4, section 5). Each runs the engine's operations as the
 * owner on Telegram through `calls` and answers in the chat it came from, in the owner's language,
 * split at line breaks into messages Telegram takes. No command reaches the agent's model.
 */
export function createFastCommands(options: FastCommandsOptions): FastCommands {
  const { logger } = options;
  const parts = { options, bot: createBotCalls(options.api), formatters: createOwnerFormatters() };
  return {
    async answer(post, { signal }) {
      const command = commandOf(post);
      const senderId = post.sender?.id;
      if (command === undefined || senderId === undefined) {
        return false;
      }
      const context = contextOf(parts, { target: targetOf(post), senderId, signal });
      await runCaught(runs[command], context, logger);
      return true;
    },
    async press(pressed, { signal }) {
      const callback = commandCallbackSchema.safeParse(pressed.data ?? "");
      const { chatId, messageId } = pressed;
      if (!callback.success || chatId === undefined || messageId === undefined) {
        return false;
      }
      const context = pressContextOf(parts, { press: pressed, chatId, messageId }, signal);
      const { data } = callback;
      const run = async (): Promise<void> =>
        data.kind === "halve" ? runHalve(context, data.limit) : runLanguage(context, data.locale);
      await runCaught(run, context, logger);
      return true;
    },
    register: async ({ signal }) => registerCommands(options.api, { signal }),
  };
}
