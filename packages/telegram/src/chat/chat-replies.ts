import { BinferenceError, type Clock, type JsonValue, type Logger } from "@binference/core";
import type { OwnerStore } from "@binference/engine/surfaces";
import { displayOutsideText, type Formatter, type MessageLocale } from "@binference/i18n";
import type { Api } from "grammy";
import { callBotApi } from "../api/call-bot-api.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import { previewSignal } from "../throttle/preview-signal.js";
import { chatHtmlOf, statusHtmlOf } from "./chat-html.js";
import { type ChatPush, chatPushOf } from "./chat-push.schema.js";

/** Shows the agent's replies in the owner's chat: a status message while it works, then its answer. */
export interface ChatReplies {
  /**
   * Shows one push of an agent's chat topic; any other push does nothing. Resolves once Telegram
   * took what must reach the owner: the status message, the answer, a status line. Rejects with a
   * fault Telegram answered, after the work the push could do.
   */
  show(
    push: { readonly kind: string; readonly data: JsonValue },
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
  /** Resolves once every refresh of a status message in flight is done. */
  idle(): Promise<void>;
  /** Stops refreshing every status message. */
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

/** One running turn in the owner's chat: its status message and what that message shows. */
interface TurnShowing {
  readonly chatId: number;
  readonly startedAtMs: number;
  /** The status message, until the answer replaces it. */
  readonly messageId?: number;
  /** The agent's text so far, while it writes. */
  readonly draft?: string;
  /** What the status message shows now. */
  readonly shown: string;
  /** Ends the status message's refresh. */
  readonly refresh: AbortController;
  /** The refresh in flight, if any. */
  readonly refreshing: Promise<void>;
}

interface Call {
  readonly signal: AbortSignal;
}

/** What the replies work with once made. */
interface Parts {
  readonly options: ChatRepliesOptions;
  readonly bot: BotCalls;
  readonly formatter: () => Formatter;
  /** Each running turn by its agent and turn; a change replaces the record. */
  readonly turns: Map<string, TurnShowing>;
}

/** An agent's text for the owner, sent as one or more messages. */
interface Html {
  readonly chatId: number;
  readonly html: string;
}

// Telegram's own guidance: about one message a second in a chat; edits count too.
const refreshMs = 1_000;
// A draft longer than this shows its end in the status message.
const draftTail = 3_500;

function keyOf(push: ChatPush): string {
  return `${push.agent} ${push.turn}`;
}

function words(parts: Parts, key: string, values?: Readonly<Record<string, string | number>>) {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return parts.formatter().message(key, values);
}

// Changes a running turn's record, if the turn still runs.
function update(parts: Parts, key: string, change: Partial<TurnShowing>): void {
  const showing = parts.turns.get(key);
  if (showing !== undefined) {
    parts.turns.set(key, { ...showing, ...change });
  }
}

function draftText(draft: string): string {
  const lines = draft.split("\n").map((line) => displayOutsideText(line, Number.POSITIVE_INFINITY));
  const shown = lines.join("\n").trim();
  return shown.length > draftTail ? `…${shown.slice(-draftTail)}` : shown;
}

// The agent's text so far once it writes, else how long it has worked.
function statusTextOf(parts: Parts, showing: TurnShowing): string {
  const draft = showing.draft === undefined ? "" : draftText(showing.draft);
  if (draft !== "") {
    return draft;
  }
  const seconds = Math.floor((parts.options.clock.now() - showing.startedAtMs) / 1_000);
  return words(parts, "telegram.chat.working", { seconds });
}

async function sendHtml(parts: Parts, message: Html, call: Call): Promise<number> {
  const sent = await callBotApi("sendMessage", call.signal, async (signal) =>
    parts.options.api.sendMessage(
      message.chatId,
      message.html,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      signal,
    ),
  );
  return sent.message_id;
}

function codeOf(error: ErrorOptions["cause"]): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

// A preview the throttler dropped leaves the status message as it was: the next refresh carries
// what it would have shown.
async function refreshOnce(parts: Parts, key: string): Promise<void> {
  const showing = parts.turns.get(key);
  if (showing?.messageId === undefined) {
    return;
  }
  const text = statusTextOf(parts, showing);
  const { chatId, messageId, refresh } = showing;
  if (text === showing.shown) {
    return;
  }
  try {
    const signal = previewSignal(refresh.signal);
    await parts.bot.edit({ chatId, messageId }, text, { signal });
    update(parts, key, { shown: text });
  } catch (error) {
    if (!refresh.signal.aborted && codeOf(error) !== "telegram.preview_dropped") {
      parts.options.logger.info("telegram.preview_failed", { errorCode: codeOf(error) });
    }
  }
}

// Refreshes the status message about once a second until the refresh ends.
async function refreshUntilStopped(parts: Parts, key: string, stop: AbortSignal): Promise<void> {
  const { clock } = parts.options;
  for (;;) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one refresh a second, one at a time
      await clock.sleep(refreshMs, stop);
    } catch {
      return;
    }
    const refreshing = refreshOnce(parts, key);
    update(parts, key, { refreshing });
    // oxlint-disable-next-line eslint/no-await-in-loop -- one refresh a second, one at a time
    await refreshing;
  }
}

// The status message goes once the answer is there or the turn ended; one Telegram no longer has
// counts as gone, and any other failure leaves it, logged.
async function removeStatus(parts: Parts, key: string, call: Call): Promise<void> {
  const showing = parts.turns.get(key);
  showing?.refresh.abort();
  const messageId = showing?.messageId;
  if (showing === undefined || messageId === undefined) {
    return;
  }
  const { messageId: _removed, ...rest } = showing;
  parts.turns.set(key, rest);
  try {
    await parts.bot.deleteMessage(showing.chatId, messageId, call);
  } catch (error) {
    call.signal.throwIfAborted();
    parts.options.logger.info("telegram.status_not_removed", { errorCode: codeOf(error) });
  }
}

async function ownerChat(parts: Parts, call: Call): Promise<number | undefined> {
  return (await parts.options.owners.get(call))?.userId;
}

async function started(parts: Parts, push: ChatPush, call: Call): Promise<void> {
  const chatId = await ownerChat(parts, call);
  const key = keyOf(push);
  if (chatId === undefined || parts.turns.has(key)) {
    return;
  }
  const text = words(parts, "telegram.chat.working", { seconds: 0 });
  const startedAtMs = parts.options.clock.now();
  const sent = await callBotApi("sendMessage", call.signal, async (signal) =>
    parts.options.api.sendMessage(chatId, text, {}, signal),
  );
  const refresh = new AbortController();
  const messageId = sent.message_id;
  const showing = { chatId, startedAtMs, messageId, shown: text, refresh };
  parts.turns.set(key, { ...showing, refreshing: Promise.resolve() });
  void refreshUntilStopped(parts, key, refresh.signal);
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

// The answer goes as new messages, which notify where an edit does not; then the status goes.
async function answered(parts: Parts, push: MessagePush, call: Call): Promise<void> {
  const key = keyOf(push);
  const showing = parts.turns.get(key);
  showing?.refresh.abort();
  const chatId = showing?.chatId ?? (await ownerChat(parts, call));
  if (chatId === undefined) {
    return;
  }
  for (const html of chatHtmlOf(await named(parts, push, call))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the pieces reach the chat in order
    await sendHtml(parts, { chatId, html }, call);
  }
  await removeStatus(parts, key, call);
}

// The next refresh of the status message shows the text the agent has written so far.
async function drafted(parts: Parts, push: MessagePush): Promise<void> {
  update(parts, keyOf(push), { draft: push.text });
  return Promise.resolve();
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

async function ended(parts: Parts, push: ChatPush, call: Call): Promise<void> {
  const key = keyOf(push);
  await removeStatus(parts, key, call);
  parts.turns.delete(key);
}

async function showPush(parts: Parts, push: ChatPush, call: Call): Promise<void> {
  switch (push.kind) {
    case "chat/turnStarted":
      return started(parts, push, call);
    case "chat/message":
      return push.final ? answered(parts, push, call) : drafted(parts, push);
    case "chat/status":
      return status(parts, push, call);
    case "chat/turnEnded":
      return ended(parts, push, call);
  }
}
/**
 * Creates the agent's replies in the owner's chat (ARCHITECTURE.md section 12). A turn that starts
 * gets one status message, edited about once a second while the agent works: how long it has
 * worked, or the text it has written so far. Its answer goes as new messages, which notify the
 * owner where an edit does not, and then the status message is deleted. A status line follows in
 * italics. Model text is always shown as text: escaped, with characters a reader cannot see
 * written out, split at 4,096 characters. Each edit of a status message is a preview: the bot's
 * throttler drops it rather than delay an answer or a card.
 */
export function createChatReplies(options: ChatRepliesOptions): ChatReplies {
  const formatters = createOwnerFormatters();
  const parts: Parts = {
    options,
    bot: createBotCalls(options.api),
    formatter: () => formatters(options.display()),
    turns: new Map(),
  };
  return {
    async show(given, call) {
      const push = chatPushOf(given);
      if (push !== undefined) {
        await showPush(parts, push, call);
      }
    },
    async idle() {
      await Promise.all([...parts.turns.values()].map(async (showing) => showing.refreshing));
    },
    close() {
      for (const showing of parts.turns.values()) {
        showing.refresh.abort();
      }
    },
  };
}
