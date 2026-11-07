import type { JsonValue } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import { type ChatPush, chatPushOf } from "@binference/protocol";
import { escapeHtml } from "../format/escape-html.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import { createAnswerPreview } from "./answer-preview.js";
import { sendHtml, sendPiece } from "./answer-sends.js";
import { type ChatHtml, chatHtmlOf, statusHtmlOf } from "./chat-html.js";
import type { ChatRepliesOptions, ReplySettings } from "./chat-replies-options.js";
import { type ChatTyping, startTyping } from "./chat-typing.js";
import { showDeposit } from "./deposit-photos.js";
import { otherReplyOf } from "./other-reply.js";
import { reasoningHtmlOf } from "./reasoning-html.js";
import { createStatusMessage, type StatusMessage, type StatusParts } from "./status-message.js";

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

/** One running turn in the owner's chat: its chat and its status message. */
interface TurnShowing {
  readonly agent: string;
  readonly chatId: number;
  readonly status: StatusMessage;
  readonly typing: ChatTyping;
  /** Whether the owner got something of the turn: its answer, a status line, a question. */
  readonly reply: { isGiven: boolean };
  /** How the model's reasoning shows in this turn, as the turn started. */
  readonly reasoning: NonNullable<ReplySettings["reasoning"]>;
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

// A turn's preview parts, its words in the owner's language as they are when each shows.
function statusPartsOf(parts: Parts): StatusParts {
  const { api, clock, logger } = parts.options;
  return {
    api,
    bot: parts.bot,
    clock,
    logger,
    label: () => words(parts, "telegram.chat.working"),
    reasoningLine: (text) => words(parts, "telegram.chat.reasoningLine", { text }),
    reasoningTitle: () => words(parts, "telegram.chat.reasoning"),
  };
}

async function started(parts: Parts, push: ChatPush, call: Call): Promise<void> {
  const chatId = await ownerChat(parts, call);
  const key = keyOf(push);
  if (chatId === undefined || parts.turns.has(key)) {
    return;
  }
  forgetEarlier(parts, push.agent);
  const { api, clock, logger } = parts.options;
  const settings: ReplySettings = parts.options.replies?.() ?? { stream: "progress" };
  const isPartial = settings.stream === "partial";
  const message = (isPartial ? createAnswerPreview : createStatusMessage)(
    statusPartsOf(parts),
    chatId,
  );
  const typing = startTyping({ api, clock, logger }, chatId);
  const [reply, reasoning] = [{ isGiven: false }, settings.reasoning ?? "off"];
  parts.turns.set(key, { agent: push.agent, chatId, status: message, typing, reply, reasoning });
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
    case "chat/reasoning":
      return reasoned(parts, push, call);
    case "chat/deposit":
      return showDeposit(
        {
          ...parts,
          showing: parts.turns.get(keyOf(push)),
          owner: async () => ownerChat(parts, call),
        },
        push,
        call.signal,
      );
    case "chat/turnEnded":
      return ended(parts, push, call);
  }
}

type ReasoningPush = Extract<ChatPush, { readonly kind: "chat/reasoning" }>;

// The model's reasoning as the turn's owner chose (decision 0377): streamed into the turn's
// preview, or kept as a message of its own once a model call ended, before the answer.
async function reasoned(parts: Parts, push: ReasoningPush, call: Call): Promise<void> {
  const showing = parts.turns.get(keyOf(push));
  if (showing?.reasoning === "streamed") {
    showing.status.think(push.text);
  }
  if (showing?.reasoning !== "kept" || !push.final) {
    return;
  }
  const title = await named(
    parts,
    { agent: push.agent, text: words(parts, "telegram.chat.reasoning") },
    call,
  );
  for (const piece of reasoningHtmlOf(title, push.text)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces reach the chat in order
    await sendPiece(parts.options, { chatId: showing.chatId, piece }, call);
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
  const reply = otherReplyOf(push);
  for (const [key, showing] of reply === undefined ? [] : parts.turns) {
    const { agent, turn } = reply ?? { agent: "" };
    if (showing.agent === agent && (turn === undefined || key === `${agent} ${turn}`)) {
      showing.reply.isGiven = true;
    }
  }
}

/**
 * Creates the agent's replies in the owner's chat (ARCHITECTURE.md section 12, decisions 0371 and
 * 0373 to 0377). The typing indicator shows while a turn runs. In the `progress` reply mode a
 * status message shows once work starts, a fixed label or the text written before the latest
 * tool, and the answer goes as new messages, which notify the owner where an edit does not; in the
 * `partial` mode the answer grows in one message that becomes it. Each preview's send and edit is
 * one the bot's throttler drops rather than delay an answer or a card; an answer Telegram refuses
 * leaves the status message saying so, and a turn that ends with nothing says so. The model's
 * reasoning shows as the owner chose. Model text shows its Markdown as Telegram's rich text from
 * a fixed set of tags over escaped text, split at 4,000 characters.
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
