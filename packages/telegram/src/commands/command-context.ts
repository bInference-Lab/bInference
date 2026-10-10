import type { ChainRegistry } from "@binference/chain";
import type { OwnerChatOperation } from "@binference/engine/surfaces";
import type { Formatter, MessageValues } from "@binference/i18n";
import type { ArgsOf, ResultOf } from "@binference/protocol";
import type { CardShowing, TelegramCards } from "../cards/create-telegram-cards.js";
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
  /** The text of a message key in the owner's language. */
  readonly words: (key: string, values?: MessageValues) => string;
  /** The numeric Telegram id of the owner who sent the command. */
  readonly senderId: number;
  readonly signal: AbortSignal;
  /** Sends text to the chat the command came from, split into messages at line breaks. */
  readonly say: (text: string, options?: { readonly replyTo?: number }) => Promise<void>;
}

/** A fast command's run: it reads and acts through the context, then answers in the chat. */
export type CommandRun = (context: CommandContext) => Promise<void>;

/**
 * Runs an operation for the owner and answers its result. A refusal is said in the chat as the
 * error message of its code, and answers `undefined`.
 */
export async function callOrSay<N extends OwnerChatOperation>(
  context: CommandContext,
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
