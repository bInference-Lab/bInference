import { z } from "zod";

/** Who sent a message or pressed a button. Only the numeric id names a person. */
export interface BotSender {
  readonly id: number;
  readonly isBot: boolean;
  /** The language the sender's Telegram app runs in, such as `zh-hans`. */
  readonly languageCode?: string;
}

/** A chat message, or an edit of one. */
export interface ChatPost {
  readonly kind: "message" | "edit";
  readonly updateId: number;
  readonly messageId: number;
  readonly chatId: number;
  /** `private`, `group`, `supergroup` or `channel`. */
  readonly chatType: string;
  /** The topic of a chat with topics. */
  readonly threadId?: number;
  readonly sender?: BotSender;
  /** Posted on behalf of a chat, such as an anonymous group admin or a channel. */
  readonly hasSenderChat: boolean;
  /** Sent through another bot's inline mode. */
  readonly isViaBot: boolean;
  /** Forwarded by hand, or forwarded automatically from a linked channel. */
  readonly isForwarded: boolean;
  /** The text, or a media message's caption. */
  readonly text?: string;
}

/** A press of an inline button. */
export interface ButtonPress {
  readonly kind: "callback";
  readonly updateId: number;
  readonly callbackId: string;
  readonly sender: BotSender;
  readonly data?: string;
  /** The chat the button's message sits in; absent for an inline-mode message. */
  readonly chatId?: number;
  readonly chatType?: string;
  readonly messageId?: number;
}

/** An update of a kind binference does not read. */
export interface OtherUpdate {
  readonly kind: "other";
  readonly updateId: number;
}

/** A Telegram update in binference's own shape. */
export type ChatUpdate = ChatPost | ButtonPress | OtherUpdate;

const rawSenderSchema = z.looseObject({
  id: z.int().positive(),
  is_bot: z.boolean(),
  language_code: z.string().optional(),
});

const rawChatSchema = z.looseObject({ id: z.int(), type: z.string() });

const presenceSchema = z.looseObject({}).optional();

const rawPostSchema = z.looseObject({
  message_id: z.int(),
  chat: rawChatSchema,
  from: rawSenderSchema.optional(),
  sender_chat: presenceSchema,
  via_bot: presenceSchema,
  forward_origin: presenceSchema,
  is_automatic_forward: z.boolean().optional(),
  message_thread_id: z.int().optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
});

const rawPressSchema = z.looseObject({
  id: z.string(),
  from: rawSenderSchema,
  data: z.string().optional(),
  message: z.looseObject({ message_id: z.int(), chat: rawChatSchema }).optional(),
});

// A part Telegram sent in a shape binference cannot read makes the update an `other` one.
const rawUpdateSchema = z.looseObject({
  update_id: z.int().nonnegative(),
  message: rawPostSchema.optional().catch(undefined),
  edited_message: rawPostSchema.optional().catch(undefined),
  callback_query: rawPressSchema.optional().catch(undefined),
});

type RawSender = z.output<typeof rawSenderSchema>;
type RawPost = z.output<typeof rawPostSchema>;
type RawPress = z.output<typeof rawPressSchema>;
type RawUpdate = z.output<typeof rawUpdateSchema>;

function senderOf(raw: RawSender): BotSender {
  return {
    id: raw.id,
    isBot: raw.is_bot,
    ...(raw.language_code === undefined ? {} : { languageCode: raw.language_code }),
  };
}

function postOf(kind: ChatPost["kind"], updateId: number, raw: RawPost): ChatPost {
  const text = raw.text ?? raw.caption;
  return {
    kind,
    updateId,
    messageId: raw.message_id,
    chatId: raw.chat.id,
    chatType: raw.chat.type,
    ...(raw.message_thread_id === undefined ? {} : { threadId: raw.message_thread_id }),
    ...(raw.from === undefined ? {} : { sender: senderOf(raw.from) }),
    hasSenderChat: raw.sender_chat !== undefined,
    isViaBot: raw.via_bot !== undefined,
    isForwarded: raw.forward_origin !== undefined || raw.is_automatic_forward === true,
    ...(text === undefined ? {} : { text }),
  };
}

function pressOf(updateId: number, raw: RawPress): ButtonPress {
  // oxlint-disable-next-line eslint/no-restricted-properties -- Telegram names the button's chat message "message"; this is the one place that reads it
  const { message: buttonMessage } = raw;
  return {
    kind: "callback",
    updateId,
    callbackId: raw.id,
    sender: senderOf(raw.from),
    ...(raw.data === undefined ? {} : { data: raw.data }),
    ...(buttonMessage === undefined
      ? {}
      : {
          chatId: buttonMessage.chat.id,
          chatType: buttonMessage.chat.type,
          messageId: buttonMessage.message_id,
        }),
  };
}

function chatUpdateOf(raw: RawUpdate): ChatUpdate {
  // oxlint-disable-next-line eslint/no-restricted-properties -- Telegram names an update's chat message "message"; this is the one place that reads it
  const { message: posted, edited_message: edited, callback_query: pressed } = raw;
  if (posted !== undefined) {
    return postOf("message", raw.update_id, posted);
  }
  if (edited !== undefined) {
    return postOf("edit", raw.update_id, edited);
  }
  if (pressed !== undefined) {
    return pressOf(raw.update_id, pressed);
  }
  return { kind: "other", updateId: raw.update_id };
}

/**
 * Parses a Telegram update as the Bot API sends it into a {@link ChatUpdate}. Only `update_id` is
 * required; a message, edit or button press in a shape it cannot read makes an `other` update.
 */
export const chatUpdateSchema: z.ZodType<ChatUpdate> = rawUpdateSchema.transform(chatUpdateOf);
