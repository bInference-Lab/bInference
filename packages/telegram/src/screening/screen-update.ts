import type { JsonValue } from "@binference/core";
import type { BotSender, ChatPost, ChatUpdate } from "../updates/chat-update.schema.js";
import type { StoredUpdate } from "../updates/stored-update.js";
import { looksLikeSecret } from "./looks-like-secret.js";

// Telegram nests a few levels deep (a reply holds a message); deeper text is screened as one.
const maxDepth = 12;

function holdsSecretText(value: JsonValue, depth: number): boolean {
  if (typeof value === "string") {
    return looksLikeSecret(value);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (depth >= maxDepth) {
    return looksLikeSecret(JSON.stringify(value));
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.some((child: JsonValue) => holdsSecretText(child, depth + 1));
}

function rawSender(sender: BotSender): JsonValue {
  return {
    id: sender.id,
    is_bot: sender.isBot,
    ...(sender.languageCode === undefined ? {} : { language_code: sender.languageCode }),
  };
}

// The ids and the facts the owner check reads; never a text.
function rawPost(post: ChatPost): JsonValue {
  return {
    message_id: post.messageId,
    chat: { id: post.chatId, type: post.chatType },
    ...(post.sender === undefined ? {} : { from: rawSender(post.sender) }),
    ...(post.threadId === undefined ? {} : { message_thread_id: post.threadId }),
    ...(post.hasSenderChat ? { sender_chat: {} } : {}),
    ...(post.isViaBot ? { via_bot: {} } : {}),
    ...(post.isForwarded ? { forward_origin: {} } : {}),
  };
}

/** The update in the Bot API's shape with only its ids: what the inbox keeps of a secret. */
function redactedUpdate(update: ChatUpdate): JsonValue {
  if (update.kind === "callback") {
    const press = { id: update.callbackId, from: rawSender(update.sender) };
    return { update_id: update.updateId, callback_query: press };
  }
  if (update.kind === "other") {
    return { update_id: update.updateId };
  }
  return update.kind === "edit"
    ? { update_id: update.updateId, edited_message: rawPost(update) }
    : { update_id: update.updateId, message: rawPost(update) };
}

/**
 * Decides what the inbox keeps of an update: the update as it came, or only its ids when any text
 * in it looks like a secret. A secret never reaches the store, a log or the agent.
 */
export function screenUpdate(raw: JsonValue, update: ChatUpdate): StoredUpdate {
  return holdsSecretText(raw, 0)
    ? { update: redactedUpdate(update), isRedacted: true }
    : { update: raw, isRedacted: false };
}
