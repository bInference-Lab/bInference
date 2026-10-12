import type { ChainRegistry } from "@binference/chain";
import type { OwnerChatOperation } from "@binference/engine/surfaces";
import type { Formatter, MessageLocale, MessageValues } from "@binference/i18n";
import type { ArgsOf, ResultOf } from "@binference/protocol";
import type { CardShowing, TelegramCards } from "../cards/create-telegram-cards.js";
import type { ButtonRows } from "../ingress/bot-calls.js";
import type { OwnerCalls } from "../ports.js";

/** What a fast command runs with: the engine's calls, the cards, and the chat it answers in. */
export interface CommandContext {
  readonly calls: OwnerCalls;
  readonly cards: TelegramCards;
  /** The cards that wait for the owner's answer, oldest first. */
  readonly waiting: (options: { readonly signal: AbortSignal }) => Promise<readonly CardShowing[]>;
  /** The chains whose coins and tokens the replies name. */
  readonly chains: ChainRegistry;
  /** The owner's formatter, as the owner's language and timezone are now. */
  readonly formatter: Formatter;
  /** When the command came, as the engine's clock reads it. */
  readonly nowMs: number;
  /** The owner's timezone now, whose days and months the replies count. */
  readonly timeZone: string;
  /** The text of a message key in the owner's language. */
  readonly words: (key: string, values?: MessageValues) => string;
  /** The numeric Telegram id of the owner who sent the command. */
  readonly senderId: number;
  /** The Mini App's HTTPS URL, which `/console` opens; none when no public address is set. */
  readonly miniAppUrl?: string;
  /**
   * Makes a single-use Mini App launch ticket for the owner who sent the command; a secret that
   * goes only into the button's address.
   */
  readonly issueLaunchTicket: () => Promise<string>;
  readonly signal: AbortSignal;
  /**
   * Sends text to the chat the command came from, split into messages at line breaks; the last
   * one carries the buttons.
   */
  readonly say: (text: string, options?: SayOptions) => Promise<void>;
}

/** How a reply goes out: the message it answers, and its buttons. */
interface SayOptions {
  readonly replyTo?: number;
  readonly buttons?: ButtonRows;
}

/** A fast command's run: it reads and acts through the context, then answers in the chat. */
export type CommandRun = (context: CommandContext) => Promise<void>;

/** What a press of a fast command's button runs with, besides what the command does. */
export interface PressContext extends CommandContext {
  /** Edits the message the pressed button sits on: its text and its buttons. */
  readonly edit: (text: string, buttons: ButtonRows) => Promise<void>;
  /** Answers the press: with a short notice, or silently to stop the button's spinner. */
  readonly answer: (notice?: string) => Promise<void>;
  /** The text of a message key in a language, such as the one the owner switches to. */
  readonly wordsIn: (locale: MessageLocale) => (key: string, values?: MessageValues) => string;
}

/** What running an operation for the owner needs: the calls, who asked, and how to answer. */
export type CallContext = Pick<CommandContext, "calls" | "senderId" | "signal" | "say" | "words">;

/**
 * Runs an operation for the owner and answers its result. A refusal is said in the chat as the
 * error message of its code, and answers `undefined`.
 */
export async function callOrSay<N extends OwnerChatOperation>(
  context: CallContext,
  op: N,
  args: ArgsOf<N>,
): Promise<ResultOf<N> | undefined> {
  const { calls, senderId, signal } = context;
  const answered = await calls.call({ op, args, senderId }, { signal });
  if (answered.ok) {
    return answered.value;
  }
  await context.say(context.words(`error.${answered.error}`));
  return undefined;
}
