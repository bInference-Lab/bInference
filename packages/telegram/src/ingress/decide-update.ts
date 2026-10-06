import type { OwnerBinding } from "../owner/owner-binding.js";
import { startCodeIn } from "../pairing/start-code.js";
import type {
  BotSender,
  ButtonPress,
  ChatPost,
  ChatUpdate,
} from "../updates/chat-update.schema.js";

/** An update from the owner, handed to the engine: a message, an edit or a button press. */
export type OwnerUpdate = ChatPost | ButtonPress;

/** Where a reply goes, and the language the sender's app runs in. */
export interface ReplyTarget {
  readonly chatId: number;
  readonly threadId?: number;
  readonly languageCode?: string;
}

/** What the ingress does with one stored update. */
export type UpdateAction =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "pair";
      readonly code: string;
      readonly userId: number;
      readonly target: ReplyTarget;
    }
  | { readonly kind: "welcome"; readonly target: ReplyTarget }
  | { readonly kind: "deleteSecret"; readonly messageId: number; readonly target: ReplyTarget }
  | { readonly kind: "deliver"; readonly update: OwnerUpdate };

/** One stored update and the owner it is judged against. */
export interface UpdateFacts {
  readonly update: ChatUpdate;
  readonly isRedacted: boolean;
  readonly owner: OwnerBinding | undefined;
}

const ignore: UpdateAction = { kind: "ignore" };

// A person writing in their own private chat with the bot: never a bot, a chat posting as
// itself, an inline bot's message or a group.
function personOf(post: ChatPost): BotSender | undefined {
  const sender = post.sender;
  const isPrivate =
    post.chatType === "private" && !post.hasSenderChat && !post.isViaBot && !sender?.isBot;
  return isPrivate && sender?.id === post.chatId ? sender : undefined;
}

function targetOf(post: ChatPost, sender: BotSender): ReplyTarget {
  return {
    chatId: post.chatId,
    ...(post.threadId === undefined ? {} : { threadId: post.threadId }),
    ...(sender.languageCode === undefined ? {} : { languageCode: sender.languageCode }),
  };
}

// The /start message a deep link sends: typed by the person, never forwarded or edited.
function startCodeOf(post: ChatPost): string | undefined {
  const isTyped = post.kind === "message" && !post.isForwarded;
  return isTyped && post.text !== undefined ? startCodeIn(post.text) : undefined;
}

function decidePost(post: ChatPost, facts: UpdateFacts): UpdateAction {
  const person = personOf(post);
  if (person === undefined) {
    return ignore;
  }
  const code = facts.isRedacted ? undefined : startCodeOf(post);
  if (facts.owner === undefined) {
    return code === undefined
      ? ignore
      : { kind: "pair", code, userId: person.id, target: targetOf(post, person) };
  }
  if (person.id !== facts.owner.userId) {
    return ignore;
  }
  if (facts.isRedacted) {
    return { kind: "deleteSecret", messageId: post.messageId, target: targetOf(post, person) };
  }
  return code === undefined
    ? { kind: "deliver", update: post }
    : { kind: "welcome", target: targetOf(post, person) };
}

function decidePress(press: ButtonPress, facts: UpdateFacts): UpdateAction {
  const ownerId = facts.owner?.userId;
  const isOwners =
    !facts.isRedacted &&
    !press.sender.isBot &&
    press.sender.id === ownerId &&
    press.chatType === "private" &&
    press.chatId === ownerId;
  return isOwners ? { kind: "deliver", update: press } : ignore;
}

/**
 * Decides what to do with a stored update. Only the owner's numeric id counts, only in the owner's
 * private chat: groups, channels, bots and every other person are ignored. Before an owner is
 * bound, only a typed `/start <code>` does anything. The owner's message that held a secret is
 * deleted with a warning and never handed on.
 */
export function decideUpdate(facts: UpdateFacts): UpdateAction {
  const { update } = facts;
  if (update.kind === "callback") {
    return decidePress(update, facts);
  }
  return update.kind === "other" ? ignore : decidePost(update, facts);
}
