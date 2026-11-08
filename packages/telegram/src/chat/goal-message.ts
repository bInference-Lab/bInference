import type { JsonValue } from "@binference/core";
import { type Formatter, goalChangeLine, progressNoteLines } from "@binference/i18n";
import { type GoalPush, goalPushOf, type ProgressNoteView } from "@binference/protocol";
import { sendHtml } from "./answer-sends.js";
import { type ChatHtml, chatHtmlOf, statusHtmlOf } from "./chat-html.js";
import type { ChatRepliesOptions } from "./chat-replies-options.js";
import { refreshPreview, type Showing } from "./preview-sends.js";

/** Shows each chat's goal changes and progress note in the owner's chat (decision 0407). */
export interface GoalMessages {
  /** Shows one push of an agent's chat topic; any push but `chat/goal` does nothing. */
  show(
    push: { readonly kind: string; readonly data: JsonValue },
    call: { readonly signal: AbortSignal },
  ): Promise<void>;
  /** Resolves once no send or edit of a progress note is under way. */
  idle(): Promise<void>;
  /** Ends every wait: no progress note is edited after it. */
  close(): void;
}

/** What the goal messages send with: the replies' options and the owner's words. */
export interface GoalMessageParts {
  readonly options: ChatRepliesOptions;
  readonly formatter: () => Formatter;
}

/** One chat's progress note message: where it stands, what it shows next, and its edits' pace. */
interface NoteMessage {
  readonly chatId: number;
  readonly showing: Showing;
  readonly next?: ChatHtml;
  readonly isWaiting: boolean;
  readonly lastAtMs: number;
}

/** Each chat's note message, by its agent and session, and the edits under way. */
interface Notes {
  readonly messages: Map<string, NoteMessage>;
  readonly under: Set<Promise<void>>;
  readonly life: AbortSignal;
}

// A progress note is edited at most once every 5 seconds, so its edits never crowd the chat.
const noteEveryMs = 5_000;
// The most chats whose note message the bot keeps editing; past it, the oldest is left as it is.
const maxNotes = 32;

function htmlOf(note: ProgressNoteView, formatter: Formatter): ChatHtml | undefined {
  return chatHtmlOf(progressNoteLines(note, formatter).join("\n"))[0];
}

function change(notes: Notes, key: string, moved: Partial<NoteMessage>): void {
  const kept = notes.messages.get(key);
  if (kept !== undefined) {
    notes.messages.set(key, { ...kept, ...moved });
  }
}

// Sends or edits the note's message with what it shows now, as a preview the throttler may drop,
// once its 5 seconds since the last edit have passed.
async function paced(parts: GoalMessageParts, notes: Notes, key: string): Promise<void> {
  const { api, clock, logger } = parts.options;
  const first = notes.messages.get(key);
  try {
    const waitMs = (first?.lastAtMs ?? 0) + noteEveryMs - clock.now();
    if (waitMs > 0) {
      await clock.sleep(waitMs, notes.life);
    }
    const message = notes.messages.get(key);
    if (message === undefined) {
      return;
    }
    const preview = { ...message, parts: { api, clock, logger }, life: notes.life };
    const shown = await refreshPreview({ ...preview, view: () => message.next });
    change(notes, key, { showing: { ...message.showing, ...shown }, lastAtMs: clock.now() });
  } catch {
    // The replies closed, or Telegram took no edit: the message keeps what it showed.
  } finally {
    change(notes, key, { isWaiting: false });
  }
}

// The chat's note message, the newest kept last; past the most, the oldest is left as it is.
function keep(notes: Notes, key: string, chatId: number): NoteMessage {
  const kept = notes.messages.get(key) ?? {
    chatId,
    showing: { failures: 0, isDone: false },
    isWaiting: false,
    lastAtMs: Number.NEGATIVE_INFINITY,
  };
  notes.messages.delete(key);
  notes.messages.set(key, kept);
  const oldest = notes.messages.keys().next();
  if (notes.messages.size > maxNotes && oldest.done !== true) {
    notes.messages.delete(oldest.value);
  }
  return kept;
}

function showNote(parts: GoalMessageParts, notes: Notes, at: { push: GoalPush; chatId: number }) {
  const { push, chatId } = at;
  const key = `${push.agent} ${push.session}`;
  if (push.change === "cleared" || push.note === undefined) {
    notes.messages.delete(key);
    return;
  }
  const message = keep(notes, key, chatId);
  const next = htmlOf(push.note, parts.formatter()) ?? message.next;
  change(notes, key, next === undefined ? {} : { next });
  if (message.isWaiting) {
    return;
  }
  change(notes, key, { isWaiting: true });
  const work = paced(parts, notes, key);
  notes.under.add(work);
  void work.finally(() => notes.under.delete(work));
}

/**
 * Creates the {@link GoalMessages} of the owner's chat (decision 0407): each change of a chat's
 * goal as a status line, and its progress note as one message per chat, sent once and edited in
 * place at most once every 5 seconds, its newest words winning, as the status message's preview is.
 */
export function createGoalMessages(parts: GoalMessageParts): GoalMessages {
  const life = new AbortController();
  const notes: Notes = { messages: new Map(), under: new Set(), life: life.signal };
  return {
    async show(given, call) {
      const push = goalPushOf(given);
      const owner = push === undefined ? undefined : await parts.options.owners.get(call);
      const chatId = owner?.userId;
      if (push === undefined || chatId === undefined) {
        return;
      }
      const line = goalChangeLine(push.change, push.goal, parts.formatter());
      if (line !== undefined) {
        await sendHtml(parts.options, { chatId, html: statusHtmlOf(line) }, call);
      }
      showNote(parts, notes, { push, chatId });
    },
    idle: async () => {
      await Promise.all(notes.under);
    },
    close: () => life.abort(),
  };
}
