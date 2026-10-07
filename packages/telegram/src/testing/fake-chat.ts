import { err, type JsonValue, ok, type Result } from "@binference/core";
import { z } from "zod";
import { type FakeEntity, type FormattedText, parseFakeHtml } from "./fake-html.js";

/** An inline keyboard button as the bot drew it. */
export interface FakeButton {
  readonly text: string;
  /** The callback data a press of the button carries. */
  readonly data?: string;
}

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
}

/** A message as the bot sent it: the text a reader saw then. */
export interface SentText {
  readonly chatId: number;
  readonly text: string;
  readonly threadId?: number;
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
  messages(): readonly FakeMessage[];
  sent(): readonly SentText[];
  deleted(): readonly DeletedMessage[];
  edits(): readonly FakeEdit[];
  answers(): readonly CallbackAnswer[];
}

interface ChatsState {
  readonly messages: Map<string, FakeMessage>;
  readonly sent: SentText[];
  readonly deleted: DeletedMessage[];
  readonly edits: FakeEdit[];
  readonly answers: CallbackAnswer[];
  readonly nextMessageId: () => number;
}

type Keyboard = readonly (readonly FakeButton[])[];

/** A message's content: what a reader sees and its buttons. */
interface Content extends FormattedText {
  readonly buttons: Keyboard;
}

const maxTextLength = 4096;
const maxDataBytes = 64;
const encoder = new TextEncoder();
const staleQuery =
  "Bad Request: query is too old and response timeout expired or query ID is invalid";

const buttonSchema = z.looseObject({
  text: z.string().min(1),
  callback_data: z.string().optional(),
});
const markupSchema = z.looseObject({ inline_keyboard: z.array(z.array(buttonSchema)) }).optional();
const targetShape = { chat_id: z.int(), message_id: z.int() };
const contentShape = {
  text: z.string(),
  parse_mode: z.string().optional(),
  reply_markup: markupSchema,
};
const sendSchema = z.looseObject({
  chat_id: z.int(),
  message_thread_id: z.int().optional(),
  ...contentShape,
});
const editTextSchema = z.looseObject({ ...targetShape, ...contentShape });
const editMarkupSchema = z.looseObject({ ...targetShape, reply_markup: markupSchema });
const deleteSchema = z.looseObject(targetShape);
const answerSchema = z.looseObject({
  callback_query_id: z.string().min(1),
  text: z.string().max(200).optional(),
  show_alert: z.boolean().optional(),
});

type Markup = z.output<typeof markupSchema>;
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

function keyboardOf(markup: Markup): Result<Keyboard, string> {
  const rows = (markup?.inline_keyboard ?? []).map((row) =>
    row.map((button) => ({
      text: button.text,
      ...(button.callback_data === undefined ? {} : { data: button.callback_data }),
    })),
  );
  const fits = rows.flat().every((button) => {
    const bytes = encoder.encode(button.data ?? "x").length;
    return bytes >= 1 && bytes <= maxDataBytes;
  });
  return fits ? ok(rows) : err("Bad Request: BUTTON_DATA_INVALID");
}

function contentOf(call: Pick<ContentCall, "text" | "parse_mode" | "reply_markup">) {
  const shown = formatted(call.text, call.parse_mode);
  if (!shown.ok) {
    return shown;
  }
  const buttons = keyboardOf(call.reply_markup);
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
  const thread = threadId === undefined ? {} : { threadId };
  const target = { chatId: call.value.chat_id, messageId: state.nextMessageId() };
  const message = { ...target, ...thread, ...content.value };
  state.messages.set(keyOf(target.chatId, target.messageId), message);
  state.sent.push({ chatId: target.chatId, text: message.text, ...thread });
  return ok(messageJson(message));
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
  const buttons = keyboardOf(call.value.reply_markup);
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
  editMessageText,
  editMessageReplyMarkup,
  deleteMessage,
  answerCallbackQuery,
};

/** Creates the in-memory chats of a fake Bot API; message ids start after 1000. */
export function createFakeChats(): FakeChats {
  let lastMessageId = 1000;
  const state: ChatsState = {
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
  const calls = Object.fromEntries(
    Object.entries(chatCalls).map(([method, call]): [string, ChatCall] => [
      method,
      (body) => call(state, body),
    ]),
  );
  return {
    calls,
    messages: () => [...state.messages.values()],
    sent: () => [...state.sent],
    deleted: () => [...state.deleted],
    edits: () => [...state.edits],
    answers: () => [...state.answers],
  };
}
