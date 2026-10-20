import type { JsonValue, Logger } from "@binference/core";
import type { LaunchDraftDesk, LaunchDraftStanding, OwnerStore } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import { type LaunchDraftPush, launchDraftPushOf } from "@binference/protocol";
import type { Api } from "grammy";
import { answerPress, sendButtonMessage, type TopicButtons } from "../chat/button-message.js";
import { escapeHtml } from "../format/escape-html.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import type { LaunchDraftAnswers } from "../ports.js";
import type { ButtonPress } from "../updates/chat-update.schema.js";
import { launchDraftCallbackSchema } from "./launch-draft-callback.schema.js";
import { launchDraftButtons, launchDraftHtml, type DraftWords } from "./launch-draft-html.js";
import { sendDraftPhoto } from "./send-draft-photo.js";

/**
 * The agent's launch drafts in the owner's chat, with Start launch and Drop (decision 0285):
 * `chat/launchDraft` sends a draft with its buttons, `chat/launchDraftClosed` turns its message into
 * how it ended.
 */
export type TelegramLaunchDrafts = TopicButtons;

/** What {@link createTelegramLaunchDrafts} needs. */
export interface TelegramLaunchDraftsOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** Who owns the install: drafts go to the owner's private chat. */
  readonly owners: OwnerStore;
  /** The engine's open drafts, as their messages show them. */
  readonly drafts: Pick<LaunchDraftDesk, "showing">;
  /** The engine's side: it checks the presser and starts or drops the draft. */
  readonly answers: LaunchDraftAnswers;
  readonly logger: Logger;
  /** The owner's language and timezone as they are now, read for each message. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
}

interface Call {
  readonly signal: AbortSignal;
}

/** Where a draft's message sits in the owner's chat. */
interface SentDraft {
  readonly chatId: number;
  readonly messageId: number;
}

// The drafts' messages the bot remembers, to turn each into how it ended: one per agent is open
// at a time, so this many is far past what an install holds.
const mostSent = 64;

/** What the drafts work with once made. */
interface Parts {
  readonly options: TelegramLaunchDraftsOptions;
  readonly bot: BotCalls;
  readonly formatter: () => ReturnType<ReturnType<typeof createOwnerFormatters>>;
  /**
   * Each open draft's message, by the draft's id, at most {@link mostSent}; a restart forgets
   * them, as it does drafts.
   */
  readonly sent: Map<string, SentDraft>;
}

function wordsOf(parts: Parts): DraftWords {
  const formatter = parts.formatter();
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return (key, values) => formatter.message(key, values);
}

// Sends an open draft to the owner's chat with its buttons, and keeps where it went.
async function drafted(parts: Parts, draft: string, call: Call): Promise<void> {
  const { options } = parts;
  const owner = await options.owners.get(call);
  const showing = options.drafts.showing(draft);
  if (owner === undefined || showing === undefined) {
    return;
  }
  const formatter = parts.formatter();
  const words = wordsOf(parts);
  const display = { formatter, assets: showing.assets };
  const html = launchDraftHtml(showing, {
    words,
    display,
    until: formatter.time(showing.expiresAtMs),
  });
  // The owner sees the same picture Start publishes, right above the draft that names it; a draft
  // whose picture cannot be shown cannot start (decision 0286).
  const chatId = owner.userId;
  const shown =
    showing.photo === undefined
      ? undefined
      : await sendDraftPhoto(options.api, { chatId, image: showing.photo }, call.signal);
  const isUnshown = showing.photo !== undefined && shown === undefined;
  const buttons = launchDraftButtons(showing.ref, words, { canStart: !isUnshown });
  const text = isUnshown ? `${html}\n${escapeHtml(words("telegram.draft.noPhoto"))}` : html;
  const replyTo = shown === undefined ? {} : { replyTo: shown };
  const messageId = await sendButtonMessage(
    options.api,
    { chatId, html: text, buttons, ...replyTo },
    call.signal,
  );
  parts.sent.set(draft, { chatId, messageId });
  // A Map keeps its keys in the order they came: past the most, the oldest message goes first,
  // and keeps its buttons, which still reach the engine.
  for (const oldest of [...parts.sent.keys()].slice(0, Math.max(0, parts.sent.size - mostSent))) {
    parts.sent.delete(oldest);
  }
}

type Closed = Extract<LaunchDraftPush, { readonly kind: "chat/launchDraftClosed" }>;

// The line a draft's message becomes once it ended.
function endLine(parts: Parts, closed: Closed): string {
  const words = wordsOf(parts);
  if (closed.outcome !== "failed") {
    return words(`telegram.draft.${closed.outcome}`);
  }
  return closed.reason === undefined
    ? words("telegram.draft.failed", { reason: words(`error.${closed.error ?? "internal.error"}`) })
    : words("telegram.draft.ended", { reason: words(`reason.${closed.reason}`) });
}

// The draft's message loses its buttons and says how the draft ended.
async function ended(parts: Parts, closed: Closed, call: Call): Promise<void> {
  const at = parts.sent.get(closed.draft);
  parts.sent.delete(closed.draft);
  if (at !== undefined) {
    await parts.bot.edit(at, endLine(parts, closed), { signal: call.signal });
  }
}

async function show(
  parts: Parts,
  push: { readonly kind: string; readonly data: JsonValue },
  call: Call,
): Promise<void> {
  const read = launchDraftPushOf(push);
  if (read?.kind === "chat/launchDraft") {
    await drafted(parts, read.draft, call);
  }
  if (read?.kind === "chat/launchDraftClosed") {
    await ended(parts, read, call);
  }
}

// The press's notice: at most 200 characters, as Telegram's answer to a press holds.
function noticeOf(parts: Parts, standing: LaunchDraftStanding): string {
  const words = wordsOf(parts);
  return words(`telegram.draft.answer.${standing.status === "ended" ? "failed" : standing.status}`);
}

async function press(parts: Parts, pressed: ButtonPress, call: Call): Promise<boolean> {
  const callback = launchDraftCallbackSchema.safeParse(pressed.data ?? "");
  if (!callback.success) {
    return false;
  }
  const asked = { ...callback.data, presserId: pressed.sender.id };
  const standing = await parts.options.answers.answer(asked, call);
  // A press the engine did not take for the owner's gets no answer, as a card's does.
  if (standing.status !== "unknown") {
    const notice = noticeOf(parts, standing);
    await answerPress(
      parts.bot,
      { callbackId: pressed.callbackId, notice },
      {
        signal: call.signal,
        logger: parts.options.logger,
      },
    );
  }
  return true;
}

/**
 * Creates the agent's launch drafts in the owner's chat (spec 4, section 8.5). A draft is every
 * line its launch card will show from the draft, escaped, under a header naming the agent, with
 * Start launch and Drop carrying `bnf1:s:<y|n>:<ref>`. The engine checks the presser and starts or
 * drops the draft before Telegram hears back; once it ends, its message loses its buttons and says
 * how it ended: started, dropped, expired, replaced, or refused with the reason.
 */
export function createTelegramLaunchDrafts(
  options: TelegramLaunchDraftsOptions,
): TelegramLaunchDrafts {
  const formatters = createOwnerFormatters();
  const parts: Parts = {
    options,
    bot: createBotCalls(options.api),
    formatter: () => formatters(options.display()),
    sent: new Map(),
  };
  return {
    show: async (push, call) => show(parts, push, call),
    press: async (pressed, call) => press(parts, pressed, call),
  };
}
