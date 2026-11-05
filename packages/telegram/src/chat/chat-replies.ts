import type { Clock, JsonValue, Logger } from "@binference/core";
import type { OwnerStore } from "@binference/engine/surfaces";
import type { Formatter, MessageLocale } from "@binference/i18n";
import { type ChatPush, chatPushOf } from "@binference/protocol";
import type { Api } from "grammy";
import { isEntitiesUnparsed } from "../api/bot-api-error.schema.js";
import { callBotApi } from "../api/call-bot-api.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import { type ChatHtml, chatHtmlOf, statusHtmlOf } from "./chat-html.js";
import { createStatusMessage, type StatusMessage } from "./status-message.js";

/** Shows the agent's replies in the owner's chat: a status message while it works, then its answer. */
export interface ChatReplies {
  /**
   * Shows one push of an agent's chat topic; any other push does nothing. Resolves once Telegram
   * took what must reach the owner: the answer, a status line. Rejects with a fault Telegram
   * answered, after the work the push could do.
   */
  show(
    push: { readonly kind: string; readonly data: JsonValue },
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
  /** Resolves once every send, edit and removal of a status message in flight is done. */
  idle(): Promise<void>;
  /** Stops refreshing every status message; a removal that waits goes at once. */
  close(): void;
}

/** What {@link createChatReplies} needs. */
export interface ChatRepliesOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** Who owns the install: the replies go to the owner's private chat. */
  readonly owners: OwnerStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The owner's language and timezone as they are now, read for each message. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
  /**
   * The name of each agent that is not archived, by its id. While there are several, each answer
   * and status line starts with its agent's name (decision 0204); left out, none does.
   */
  readonly agentNames?: (call: Call) => Promise<ReadonlyMap<string, string>>;
}

/** One running turn in the owner's chat: its chat and its status message. */
interface TurnShowing {
  readonly agent: string;
  readonly chatId: number;
  readonly status: StatusMessage;
}

interface Call {
  readonly signal: AbortSignal;
}

/** What the replies work with once made. */
interface Parts {
  readonly options: ChatRepliesOptions;
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  /** Each running turn by its agent and turn. */
  readonly turns: Map<string, TurnShowing>;
  /** The status messages that wait for their time to go, by their removal. */
  readonly removals: Map<Promise<void>, StatusMessage>;
}

// The most turns the replies follow at once; past it, the oldest one's status message goes.
const maxTurns = 32;

function keyOf(push: ChatPush): string {
  return `${push.agent} ${push.turn}`;
}

function words(parts: Parts, key: string, values?: Readonly<Record<string, string | number>>) {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return parts.formatter().message(key, values);
}

async function sendHtml(parts: Parts, message: { chatId: number; html: string }, call: Call) {
  await callBotApi("sendMessage", call.signal, async (signal) =>
    parts.options.api.sendMessage(
      message.chatId,
      message.html,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      signal,
    ),
  );
}

// A piece whose HTML Telegram cannot read goes again as plain text, so the owner still gets the
// answer; the log names the message, never its words.
async function sendPiece(
  parts: Parts,
  message: { readonly chatId: number; readonly piece: ChatHtml },
  call: Call,
): Promise<void> {
  const { chatId, piece } = message;
  try {
    await sendHtml(parts, { chatId, html: piece.html }, call);
  } catch (error) {
    if (!isEntitiesUnparsed(error)) {
      throw error;
    }
    const sent = await callBotApi("sendMessage", call.signal, async (signal) =>
      parts.options.api.sendMessage(
        chatId,
        piece.plain,
        { link_preview_options: { is_disabled: true } },
        signal,
      ),
    );
    parts.options.logger.info("telegram.chat_sent_plain", { messageId: sent.message_id });
  }
}

// The status message goes once it showed long enough; the replies keep the wait until it is done.
function removeStatus(parts: Parts, showing: TurnShowing | undefined): void {
  if (showing === undefined) {
    return;
  }
  const removal = showing.status.remove();
  parts.removals.set(removal, showing.status);
  void removal.finally(() => parts.removals.delete(removal));
}

// Ends the turn's showing: its status message goes and the turn is forgotten.
function forget(parts: Parts, key: string): void {
  removeStatus(parts, parts.turns.get(key));
  parts.turns.delete(key);
}

async function ownerChat(parts: Parts, call: Call): Promise<number | undefined> {
  return (await parts.options.owners.get(call))?.userId;
}

// A new turn of an agent leaves no status message of an earlier one behind.
function forgetEarlier(parts: Parts, agent: string): void {
  for (const [key, showing] of parts.turns) {
    if (showing.agent === agent) {
      forget(parts, key);
    }
  }
  const oldest = parts.turns.keys().next();
  if (parts.turns.size >= maxTurns && oldest.done !== true) {
    forget(parts, oldest.value);
  }
}

async function started(parts: Parts, push: ChatPush, call: Call): Promise<void> {
  const chatId = await ownerChat(parts, call);
  const key = keyOf(push);
  if (chatId === undefined || parts.turns.has(key)) {
    return;
  }
  forgetEarlier(parts, push.agent);
  const { api, clock, logger } = parts.options;
  const headline = (seconds: number): string => words(parts, "telegram.chat.working", { seconds });
  const statusParts = { api, bot: parts.bot, clock, logger, headline };
  const message = createStatusMessage(statusParts, { chatId, startedAtMs: clock.now() });
  parts.turns.set(key, { agent: push.agent, chatId, status: message });
}

type MessagePush = Extract<ChatPush, { readonly kind: "chat/message" }>;

// The agent's words, after its name while the owner has several agents (decision 0204).
async function named(
  parts: Parts,
  said: { readonly agent: string; readonly text: string },
  call: Call,
): Promise<string> {
  const { agent, text } = said;
  const names = await parts.options.agentNames?.(call);
  const name = names?.get(agent);
  return names === undefined || names.size < 2 || name === undefined
    ? text
    : words(parts, "telegram.chat.agent", { agent: name, text });
}

// An answer Telegram did not take: the status message says so in its place, or a new message
// does when none showed. A failure there leaves the chat as it is, logged.
async function notDelivered(
  parts: Parts,
  at: { chatId: number; showing?: TurnShowing },
  call: Call,
) {
  const text = words(parts, "telegram.chat.notDelivered");
  if (at.showing !== undefined && (await at.showing.status.replaceWith(text, call.signal))) {
    return;
  }
  try {
    await parts.bot.reply({ chatId: at.chatId }, text, call);
  } catch {
    parts.options.logger.info("telegram.chat_not_delivered_unsaid", {});
  }
}

// The answer goes as new messages, which notify where an edit does not; then the status goes.
async function answered(parts: Parts, push: MessagePush, call: Call): Promise<void> {
  const showing = parts.turns.get(keyOf(push));
  await showing?.status.freeze();
  const chatId = showing?.chatId ?? (await ownerChat(parts, call));
  if (chatId === undefined) {
    return;
  }
  try {
    for (const piece of chatHtmlOf(await named(parts, push, call))) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces reach the chat in order
      await sendPiece(parts, { chatId, piece }, call);
    }
  } catch (error) {
    call.signal.throwIfAborted();
    await notDelivered(parts, { chatId, ...(showing === undefined ? {} : { showing }) }, call);
    parts.turns.delete(keyOf(push));
    throw error;
  }
  forget(parts, keyOf(push));
}

type StatusPush = Extract<ChatPush, { readonly kind: "chat/status" }>;

// `{when}` is a time the engine names in epoch milliseconds; the owner reads it in their zone.
function statusLine(parts: Parts, push: StatusPush): string {
  const values = push.values ?? {};
  const { when } = values;
  const shown =
    typeof when === "number" ? { ...values, when: parts.formatter().dateTime(when) } : values;
  return words(parts, push.statusKey, shown);
}

async function status(parts: Parts, push: StatusPush, call: Call): Promise<void> {
  const chatId = parts.turns.get(keyOf(push))?.chatId ?? (await ownerChat(parts, call));
  if (chatId !== undefined) {
    const line = await named(parts, { agent: push.agent, text: statusLine(parts, push) }, call);
    await sendHtml(parts, { chatId, html: statusHtmlOf(line) }, call);
  }
}

type ProgressPush = Extract<ChatPush, { readonly kind: "chat/progress" }>;

function progress(parts: Parts, push: ProgressPush): void {
  parts.turns.get(keyOf(push))?.status.work(words(parts, push.progressKey, push.values));
}

async function showPush(parts: Parts, push: ChatPush, call: Call): Promise<void> {
  switch (push.kind) {
    case "chat/turnStarted":
      return started(parts, push, call);
    case "chat/message":
      if (push.final) {
        return answered(parts, push, call);
      }
      parts.turns.get(keyOf(push))?.status.draft(push.text);
      return Promise.resolve();
    case "chat/progress":
      progress(parts, push);
      return Promise.resolve();
    case "chat/status":
      return status(parts, push, call);
    case "chat/turnEnded":
      forget(parts, keyOf(push));
      return Promise.resolve();
  }
}

/**
 * Creates the agent's replies in the owner's chat (ARCHITECTURE.md section 12, decision 0371). A
 * turn that runs past 1.5 seconds, or runs a tool sooner, gets one status message, edited at most
 * once a second while the agent works: how long it has worked, a line for each tool it ran and
 * the text it wrote before it, and the text it writes now, drawn as an answer is. Each edit is a
 * preview the bot's throttler drops rather than delay an answer or a card. The answer goes as new
 * messages, which notify the owner where an edit does not, and the status message is deleted once
 * it has shown for 4 seconds; an answer Telegram refuses leaves the status message saying so. A
 * status line follows in italics. Model text shows its Markdown as Telegram's rich text from a
 * fixed set of tags over escaped text, split at 4,096 characters; a message Telegram cannot parse
 * goes again as plain text.
 */
export function createChatReplies(options: ChatRepliesOptions): ChatReplies {
  const formatters = createOwnerFormatters();
  const parts: Parts = {
    options,
    bot: createBotCalls(options.api),
    formatter: () => formatters(options.display()),
    turns: new Map(),
    removals: new Map(),
  };
  return {
    async show(given, call) {
      const push = chatPushOf(given);
      if (push !== undefined) {
        await showPush(parts, push, call);
      }
    },
    async idle() {
      const turns = [...parts.turns.values()].map(async (showing) => showing.status.idle());
      await Promise.all([...turns, ...parts.removals.keys()]);
    },
    close() {
      for (const message of [...parts.turns.values()].map(({ status: shown }) => shown)) {
        message.close();
      }
      for (const message of parts.removals.values()) {
        message.close();
      }
    },
  };
}
