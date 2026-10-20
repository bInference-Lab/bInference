import { err, type JsonValue, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { FakeFileKind } from "./fake-files.js";
import { type FakeEntity, type FormattedText, parseFakeHtml } from "./fake-html.js";
import { type FakeButton, type Keyboard, keyboardOf, markupSchema } from "./fake-keyboard.js";
import { type FakeSentFile, type SentFile, sendFile } from "./fake-sent-files.js";
import { createFakeTopics, type FakeTopic, type FakeTopics } from "./fake-topics.js";

/** An inline keyboard button as the bot drew it. */
/** A message the bot sent, as it stands after every edit. */
export interface FakeMessage {
  readonly chatId: number;
  readonly messageId: number;
  readonly threadId?: number;
  /** The text a reader sees, after the HTML is parsed. */
  readonly text: string;
  readonly entities: readonly FakeEntity[];
  /** The inline keyboard, row by row; empty once the buttons are removed. */
  readonly buttons: readonly (readonly FakeButton[])[];
  /** The file a `sendPhoto` or `sendDocument` sent, by its id; its text is the caption, or none. */
  readonly file?: FakeSentFile;
}

/** A message as the bot sent it: the text a reader saw then. */
export interface SentText {
  readonly chatId: number;
  readonly text: string;
  readonly threadId?: number;
  /** The message it replies to, as its `reply_parameters` named it. */
  readonly replyTo?: number;
  /** The file it sent, for a `sendPhoto` or `sendDocument`. */
  readonly file?: FakeSentFile;
}

/** A message the bot deleted. */
export interface DeletedMessage {
  readonly chatId: number;
  readonly messageId: number;
}

/** One edit the Bot API accepted. */
export interface FakeEdit {
  readonly method: "editMessageText" | "editMessageReplyMarkup";
  readonly chatId: number;
  readonly messageId: number;
}

/** The bot's answer to a button press. */
export interface CallbackAnswer {
  readonly callbackId: string;
  /** The notice the presser sees; absent for a silent answer. */
  readonly text?: string;
  readonly showAlert?: boolean;
}

/** A call the chats accept, answered with its result or the description of a 400. */
type ChatCall = (body: string) => Result<JsonValue, string>;

/** The bot's chats in memory: sends, edits, deletes and button answers, with Telegram's checks. */
export interface FakeChats {
  readonly calls: Readonly<Record<string, ChatCall>>;
  /** The topics the bot made, deleted ones left out. */
  topics(): readonly FakeTopic[];
  /** Deletes a topic, as the owner may in the chat: a message to it is refused from then on. */
  deleteTopic(chatId: number, threadId: number): void;
  messages(): readonly FakeMessage[];
  sent(): readonly SentText[];
  deleted(): readonly DeletedMessage[];
  edits(): readonly FakeEdit[];
  answers(): readonly CallbackAnswer[];
}

interface ChatsState {
  readonly topics: FakeTopics;
  /** What the bot's files are held as, by id; `undefined` for one it never received. */
  readonly fileKindOf: (fileId: string) => FakeFileKind | undefined;
  readonly messages: Map<string, FakeMessage>;
  readonly sent: SentText[];
  readonly deleted: DeletedMessage[];
  readonly edits: FakeEdit[];
  readonly answers: CallbackAnswer[];
  readonly nextMessageId: () => number;
}

/** A message's content: what a reader sees and its buttons. */
interface Content extends FormattedText {
  readonly buttons: Keyboard;
}

const maxTextLength = 4096;
const staleQuery =
  "Bad Request: query is too old and response timeout expired or query ID is invalid";

const targetShape = { chat_id: z.int(), message_id: z.int() };
const contentShape = {
  text: z.string(),
  parse_mode: z.string().optional(),
  reply_markup: markupSchema,
};
const sendSchema = z.looseObject({
  chat_id: z.int(),
  message_thread_id: z.int().optional(),
  reply_parameters: z.looseObject({ message_id: z.int() }).optional(),
  ...contentShape,
});
const editTextSchema = z.looseObject({ ...targetShape, ...contentShape });
const editMarkupSchema = z.looseObject({ ...targetShape, reply_markup: markupSchema });
const deleteSchema = z.looseObject(targetShape);
const threadGone = "Bad Request: message thread not found";
const answerSchema = z.looseObject({
  callback_query_id: z.string().min(1),
  text: z.string().max(200).optional(),
  show_alert: z.boolean().optional(),
});

type ContentCall = z.output<typeof editTextSchema>;

function parsed<T>(schema: z.ZodType<T>, body: string): Result<T, string> {
  const result = schema.safeParse(JSON.parse(body));
  return result.success ? ok(result.data) : err("Bad Request: wrong parameters");
}

function formatted(text: string, parseMode: string | undefined): Result<FormattedText, string> {
  if (parseMode !== undefined && parseMode !== "HTML") {
    return err("Bad Request: unsupported parse_mode");
  }
  const shown = parseMode === undefined ? ok({ text, entities: [] }) : parseFakeHtml(text);
  if (!shown.ok) {
    return shown;
  }
  if (shown.value.text.length === 0) {
    return err("Bad Request: message text is empty");
  }
  return shown.value.text.length > maxTextLength ? err("Bad Request: message is too long") : shown;
}

function contentOf(call: Pick<ContentCall, "chat_id" | "text" | "parse_mode" | "reply_markup">) {
  const shown = formatted(call.text, call.parse_mode);
  if (!shown.ok) {
    return shown;
  }
  const buttons = keyboardOf(call.reply_markup, call.chat_id);
  return buttons.ok ? ok<Content>({ ...shown.value, buttons: buttons.value }) : buttons;
}

function keyOf(chatId: number, messageId: number): string {
  return `${String(chatId)}:${String(messageId)}`;
}

function messageJson(message: FakeMessage): JsonValue {
  return {
    message_id: message.messageId,
    date: 1,
    chat: { id: message.chatId, type: "private" },
    text: message.text,
    ...(message.threadId === undefined ? {} : { message_thread_id: message.threadId }),
  };
}

function contentKey(message: FakeMessage): string {
  return JSON.stringify([message.text, message.entities, message.buttons]);
}

// Telegram refuses an edit to a message it does not have, and one that changes nothing.
function replace(state: ChatsState, method: FakeEdit["method"], next: FakeMessage) {
  const key = keyOf(next.chatId, next.messageId);
  const current = state.messages.get(key);
  if (current === undefined) {
    return err("Bad Request: message to edit not found");
  }
  const thread = current.threadId === undefined ? {} : { threadId: current.threadId };
  const edited = { ...next, ...thread };
  if (contentKey(current) === contentKey(edited)) {
    return err("Bad Request: message is not modified");
  }
  state.messages.set(key, edited);
  state.edits.push({ method, chatId: next.chatId, messageId: next.messageId });
  return ok(messageJson(edited));
}

function sendMessage(state: ChatsState, body: string): Result<JsonValue, string> {
  const call = parsed(sendSchema, body);
  if (!call.ok) {
    return call;
  }
  const content = contentOf(call.value);
  if (!content.ok) {
    return content;
  }
  const threadId = call.value.message_thread_id;
  if (threadId !== undefined && state.topics.isGone(call.value.chat_id, threadId)) {
    return err(threadGone);
  }
  const thread = threadId === undefined ? {} : { threadId };
  const target = { chatId: call.value.chat_id, messageId: state.nextMessageId() };
  const message = { ...target, ...thread, ...content.value };
  state.messages.set(keyOf(target.chatId, target.messageId), message);
  const replyTo = call.value.reply_parameters?.message_id;
  const reply = replyTo === undefined ? {} : { replyTo };
  state.sent.push({ chatId: target.chatId, text: message.text, ...thread, ...reply });
  return ok(messageJson(message));
}

// A file sent again by its id, kept as a message the chat holds, with what a reader saw.
function keepFile(state: ChatsState, sent: SentFile): JsonValue {
  const target = { chatId: sent.chatId, messageId: state.nextMessageId() };
  const message = { ...target, text: "", entities: [], buttons: [], file: sent.file };
  state.messages.set(keyOf(target.chatId, target.messageId), message);
  const reply = sent.replyTo === undefined ? {} : { replyTo: sent.replyTo };
  state.sent.push({ chatId: target.chatId, text: "", file: sent.file, ...reply });
  return messageJson(message);
}

function editMessageText(state: ChatsState, body: string): Result<JsonValue, string> {
  const call = parsed(editTextSchema, body);
  if (!call.ok) {
    return call;
  }
  const content = contentOf(call.value);
  if (!content.ok) {
    return content;
  }
  const target = { chatId: call.value.chat_id, messageId: call.value.message_id };
  return replace(state, "editMessageText", { ...target, ...content.value });
}

function editMessageReplyMarkup(state: ChatsState, body: string): Result<JsonValue, string> {
  const call = parsed(editMarkupSchema, body);
  if (!call.ok) {
    return call;
  }
  const buttons = keyboardOf(call.value.reply_markup, call.value.chat_id);
  if (!buttons.ok) {
    return buttons;
  }
  const current = state.messages.get(keyOf(call.value.chat_id, call.value.message_id));
  return current === undefined
    ? err("Bad Request: message to edit not found")
    : replace(state, "editMessageReplyMarkup", { ...current, buttons: buttons.value });
}

function deleteMessage(state: ChatsState, body: string): Result<JsonValue, string> {
  const call = parsed(deleteSchema, body);
  if (!call.ok) {
    return call;
  }
  state.messages.delete(keyOf(call.value.chat_id, call.value.message_id));
  state.deleted.push({ chatId: call.value.chat_id, messageId: call.value.message_id });
  return ok(true);
}

// Telegram takes one answer per press.
function answerCallbackQuery(state: ChatsState, body: string): Result<JsonValue, string> {
  const call = parsed(answerSchema, body);
  if (!call.ok) {
    return call;
  }
  const { callback_query_id: callbackId, text, show_alert: showAlert } = call.value;
  if (state.answers.some((answer) => answer.callbackId === callbackId)) {
    return err(staleQuery);
  }
  state.answers.push({
    callbackId,
    ...(text === undefined ? {} : { text }),
    ...(showAlert === undefined ? {} : { showAlert }),
  });
  return ok(true);
}

const chatCalls = {
  sendMessage,
  sendPhoto: (state: ChatsState, body: string) =>
    sendFile({ ...state, keep: (sent) => keepFile(state, sent) }, "photo", body),
  sendDocument: (state: ChatsState, body: string) =>
    sendFile({ ...state, keep: (sent) => keepFile(state, sent) }, "document", body),
  editMessageText,
  editMessageReplyMarkup,
  deleteMessage,
  answerCallbackQuery,
};

/**
 * Creates the in-memory chats of a fake Bot API; message ids start after 1000. With `hasTopics`,
 * the bot may make topics in private chats, and a message goes only to a topic it made.
 */
export function createFakeChats(
  options: {
    readonly hasTopics?: boolean;
    readonly fileKindOf?: (fileId: string) => FakeFileKind | undefined;
  } = {},
): FakeChats {
  let lastMessageId = 1000;
  const state: ChatsState = {
    topics: createFakeTopics({ hasTopics: options.hasTopics ?? false }),
    fileKindOf: options.fileKindOf ?? (() => undefined),
    messages: new Map(),
    sent: [],
    deleted: [],
    edits: [],
    answers: [],
    nextMessageId: () => {
      lastMessageId += 1;
      return lastMessageId;
    },
  };
  const calls: Record<string, ChatCall> = Object.fromEntries(
    Object.entries(chatCalls).map(([method, call]): [string, ChatCall] => [
      method,
      (body) => call(state, body),
    ]),
  );
  calls["createForumTopic"] = (body) => state.topics.create(body);
  return {
    calls,
    topics: () => state.topics.list(),
    deleteTopic: (chatId, threadId) => {
      state.topics.delete(chatId, threadId);
    },
    messages: () => [...state.messages.values()],
    sent: () => [...state.sent],
    deleted: () => [...state.deleted],
    edits: () => [...state.edits],
    answers: () => [...state.answers],
  };
}
