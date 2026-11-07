import type { Formatter } from "@binference/i18n";
import type { BotCalls } from "../ingress/bot-calls.js";
import type { ChatRepliesOptions, ReplySettings } from "./chat-replies-options.js";
import type { ChatTyping } from "./chat-typing.js";
import type { StatusMessage } from "./status-message.js";

/** One running turn in the owner's chat: its chat and its status message. */
export interface TurnShowing {
  readonly agent: string;
  readonly chatId: number;
  readonly status: StatusMessage;
  readonly typing: ChatTyping;
  /** Whether the owner got something of the turn: its answer, a status line, a question. */
  readonly reply: { isGiven: boolean };
  /** How the model's reasoning shows in this turn, as the turn started. */
  readonly reasoning: NonNullable<ReplySettings["reasoning"]>;
  /** A new message of the turn's kind, for what the turn writes after something it showed. */
  readonly fresh: () => StatusMessage;
}

/** A push being shown: its stop. */
export interface Call {
  readonly signal: AbortSignal;
}

/** What the replies work with once made. */
export interface Parts {
  readonly options: ChatRepliesOptions;
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  /** Each running turn by its agent and turn. */
  readonly turns: Map<string, TurnShowing>;
  /** The status messages that wait for their time to go, by their removal. */
  readonly removals: Map<Promise<void>, StatusMessage>;
}
