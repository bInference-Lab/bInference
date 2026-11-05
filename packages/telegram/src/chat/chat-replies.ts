import type { Clock, JsonValue, Logger } from "@binference/core";
import type { OwnerStore } from "@binference/engine/surfaces";
import type { Formatter, MessageLocale } from "@binference/i18n";
import { type ChatPush, chatPushOf } from "@binference/protocol";
import type { Api } from "grammy";
import { z } from "zod";
import { escapeHtml } from "../format/escape-html.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import { createAnswerPreview } from "./answer-preview.js";
import { sendHtml, sendPiece } from "./answer-sends.js";
import { type ChatHtml, chatHtmlOf, statusHtmlOf } from "./chat-html.js";
import { type ChatTyping, startTyping } from "./chat-typing.js";
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
  /** How replies show as config.json5 holds it now, read as each turn starts; left out, `progress`. */
  readonly replies?: () => ReplySettings;
}

/**
 * How the agent's replies show while a turn runs (decision 0376): `progress` shows a status
 * message once work starts and the answer as new messages; `partial` grows the answer in one
 * message that becomes the answer in place.
 */
export interface ReplySettings {
  readonly stream: "progress" | "partial";
}

/** One running turn in the owner's chat: its chat and its status message. */
interface TurnShowing {
  readonly agent: string;
  readonly chatId: number;
  readonly status: StatusMessage;
  readonly typing: ChatTyping;
  /** Whether the owner got something of the turn: its answer, a status line, a question. */
  readonly reply: { isGiven: boolean };
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

// The pushes another part of the bot shows as a reply of a running turn: a question names its
// turn, a launch draft only its agent.
const otherReplySchema = z.looseObject({
  kind: z.enum(["chat/question", "chat/launchDraft"]),
  data: z.looseObject({ agent: z.string(), turn: z.string().optional() }),
});

// The most turns the replies follow at once; past it, the oldest one's status message goes.
const maxTurns = 32;

function keyOf(push: ChatPush): string {
  return `${push.agent} ${push.turn}`;
}

function words(parts: Parts, key: string, values?: Readonly<Record<string, string | number>>) {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return parts.formatter().message(key, values);
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

// Ends the turn's showing: its typing stops, its status message goes and the turn is forgotten.
function forget(parts: Parts, key: string): void {
  const showing = parts.turns.get(key);
  showing?.typing.stop();
  removeStatus(parts, showing);
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
  const label = (): string => words(parts, "telegram.chat.working");
  const statusParts = { api, bot: parts.bot, clock, logger, label };
  const isPartial = parts.options.replies?.().stream === "partial";
  const message = (isPartial ? createAnswerPreview : createStatusMessage)(statusParts, chatId);
  const typing = startTyping({ api, clock, logger }, chatId);
  const reply = { isGiven: false };
  parts.turns.set(key, { agent: push.agent, chatId, status: message, typing, reply });
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
// The answer's messages still to send. In the partial mode the preview becomes the first one in
// place, which notifies nobody; any other way, every one goes as a new message.
async function piecesLeft(
  parts: Parts,
  at: { readonly push: MessagePush; readonly showing: TurnShowing | undefined },
  call: Call,
): Promise<{ readonly pieces: readonly ChatHtml[]; readonly isInPlace: boolean }> {
  const pieces = chatHtmlOf(await named(parts, at.push, call));
  const [first, ...rest] = pieces;
  const isInPlace =
    first !== undefined && (await at.showing?.status.finishInPlace(first, call.signal)) === true;
  return { pieces: isInPlace ? rest : pieces, isInPlace };
}

async function answered(parts: Parts, push: MessagePush, call: Call): Promise<void> {
  const showing = parts.turns.get(keyOf(push));
  await showing?.status.freeze();
  const chatId = showing?.chatId ?? (await ownerChat(parts, call));
  if (chatId === undefined) {
    return;
  }
  const { pieces, isInPlace } = await piecesLeft(parts, { push, showing }, call);
  try {
    for (const piece of pieces) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces reach the chat in order
      await sendPiece(parts.options, { chatId, piece }, call);
    }
  } catch (error) {
    call.signal.throwIfAborted();
    const at = showing === undefined || isInPlace ? {} : { showing };
    await notDelivered(parts, { chatId, ...at }, call);
    showing?.typing.stop();
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
  const showing = parts.turns.get(keyOf(push));
  const chatId = showing?.chatId ?? (await ownerChat(parts, call));
  if (showing !== undefined) {
    showing.reply.isGiven = true;
  }
  if (chatId !== undefined) {
    const line = await named(parts, { agent: push.agent, text: statusLine(parts, push) }, call);
    await sendHtml(parts.options, { chatId, html: statusHtmlOf(line) }, call);
  }
}

type ProgressPush = Extract<ChatPush, { readonly kind: "chat/progress" }>;

function progress(parts: Parts, push: ProgressPush): void {
  parts.turns.get(keyOf(push))?.status.work();
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
      return ended(parts, push, call);
  }
}

type EndedPush = Extract<ChatPush, { readonly kind: "chat/turnEnded" }>;

// A turn that ends with nothing for the owner, no answer, no status line and no question, gets a
// line that says so, so the owner never waits on a reply that will not come.
async function ended(parts: Parts, push: EndedPush, call: Call): Promise<void> {
  const showing = parts.turns.get(keyOf(push));
  forget(parts, keyOf(push));
  if (showing === undefined || showing.reply.isGiven) {
    return;
  }
  const text = await named(
    parts,
    { agent: push.agent, text: words(parts, "telegram.chat.noAnswer") },
    call,
  );
  await sendHtml(parts.options, { chatId: showing.chatId, html: escapeHtml(text) }, call);
}

// An agent's question, or its launch draft, is a reply of its running turn, which another part of
// the bot shows.
function noteOtherReply(parts: Parts, push: { readonly kind: string; readonly data: JsonValue }) {
  const reply = otherReplySchema.safeParse(push);
  if (!reply.success) {
    return;
  }
  for (const [key, showing] of parts.turns) {
    const { agent, turn } = reply.data.data;
    if (showing.agent === agent && (turn === undefined || key === `${agent} ${turn}`)) {
      showing.reply.isGiven = true;
    }
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
 * status line follows in italics. Telegram's typing indicator shows while the turn runs (decision
 * 0372). Model text shows its Markdown as Telegram's rich text from a fixed set of tags over
 * escaped text, split at 4,096 characters; a message Telegram cannot parse goes again as plain
 * text.
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
      noteOtherReply(parts, given);
    },
    async idle() {
      const turns = [...parts.turns.values()].map(async (showing) => showing.status.idle());
      await Promise.all([...turns, ...parts.removals.keys()]);
    },
    close() {
      for (const showing of parts.turns.values()) {
        showing.typing.stop();
        showing.status.close();
      }
      for (const message of parts.removals.values()) {
        message.close();
      }
    },
  };
}
