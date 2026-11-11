import type { JsonValue, Logger, Result } from "@binference/core";
import type { OwnerStore } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import {
  type ProtocolErrorCode,
  type ShellAnswer,
  shellPushOf,
  type ShellRequestClosedPush,
  type ShellRequestView,
} from "@binference/protocol";
import type { Api } from "grammy";
import { answerPress, sendButtonMessage, type TopicButtons } from "../chat/button-message.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import type { ButtonPress } from "../updates/chat-update.schema.js";
import { shellRequestCallbackSchema } from "./shell-request-callback.schema.js";
import {
  shellRequestButtons,
  shellRequestClosedText,
  shellRequestHtml,
  type ShellWords,
} from "./shell-request-html.js";

/**
 * The agent's shell requests in the owner's chat, with Allow once, Always allow and Refuse
 * (decision 0409): `chat/shellRequest` sends a request with its buttons, `chat/shellRequestClosed`
 * turns its message into how it ended.
 */
export type TelegramShellRequests = TopicButtons;

/** What {@link createTelegramShellRequests} needs. */
export interface TelegramShellRequestsOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** Who owns the install: requests go to the owner's private chat. */
  readonly owners: OwnerStore;
  /**
   * The engine's side: runs `shell/answer` for the presser, and refuses with `auth.scope` anyone
   * but the owner's numeric Telegram id.
   */
  readonly answer: (
    asked: ShellPress,
    call: Call,
  ) => Promise<Result<{ readonly outcome: string }, ProtocolErrorCode>>;
  /** Each agent's name, by its id, for the header that says who asks. */
  readonly agentNames: (call: Call) => Promise<ReadonlyMap<string, string>>;
  readonly logger: Logger;
  /** The owner's language and timezone as they are now, read for each message. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
}

interface Call {
  readonly signal: AbortSignal;
}

/** A press of a shell request's button: the request, the answer, and who pressed it. */
export interface ShellPress {
  readonly request: ShellRequestView["request"];
  readonly answer: ShellAnswer;
  readonly presserId: number;
}

/** Where a request's message sits in the owner's chat, and what it asked. */
interface SentRequest {
  readonly chatId: number;
  readonly messageId: number;
  readonly view: ShellRequestView;
}

// The requests' messages the bot remembers, to turn each into how it ended: one per agent is open
// at a time, so this many is far past what an install holds. A restart forgets them, as it does
// the requests.
const mostSent = 64;

interface Parts {
  readonly options: TelegramShellRequestsOptions;
  readonly bot: BotCalls;
  readonly formatter: () => ReturnType<ReturnType<typeof createOwnerFormatters>>;
  readonly sent: Map<string, SentRequest>;
}

function wordsOf(parts: Parts): ShellWords {
  const formatter = parts.formatter();
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return (key, values) => formatter.message(key, values);
}

async function nameOf(parts: Parts, agent: string, call: Call): Promise<string> {
  return (await parts.options.agentNames(call)).get(agent) ?? agent;
}

// Sends an open request to the owner's chat with its buttons, and keeps where it went.
async function asked(parts: Parts, view: ShellRequestView, call: Call): Promise<void> {
  const owner = await parts.options.owners.get(call);
  if (owner === undefined) {
    return;
  }
  const words = wordsOf(parts);
  const agent = await nameOf(parts, view.agent, call);
  const until = parts.formatter().time(view.closesAt);
  const html = shellRequestHtml(view, { words, agent, until });
  const buttons = shellRequestButtons(view, words);
  const chatId = owner.userId;
  const messageId = await sendButtonMessage(
    parts.options.api,
    { chatId, html, buttons },
    call.signal,
  );
  // Past the most, the oldest request's message is forgotten; its buttons still reach the engine.
  const [oldest] = parts.sent.keys();
  if (parts.sent.size >= mostSent && oldest !== undefined) {
    parts.sent.delete(oldest);
  }
  parts.sent.set(view.request, { chatId, messageId, view });
}

// The request's message loses its buttons and says how it ended.
async function closed(parts: Parts, push: ShellRequestClosedPush, call: Call): Promise<void> {
  const at = parts.sent.get(push.request);
  parts.sent.delete(push.request);
  if (at === undefined) {
    return;
  }
  const agent = await nameOf(parts, push.agent, call);
  const text = shellRequestClosedText(at.view, {
    words: wordsOf(parts),
    agent,
    outcome: push.outcome,
  });
  await parts.bot.edit(at, text, { signal: call.signal });
}

async function show(
  parts: Parts,
  push: { readonly kind: string; readonly data: JsonValue },
  call: Call,
): Promise<void> {
  const read = shellPushOf(push);
  if (read?.kind === "chat/shellRequest") {
    await asked(parts, read.view, call);
  }
  if (read?.kind === "chat/shellRequestClosed") {
    await closed(parts, read, call);
  }
}

// A press on a request the engine no longer holds: the message loses its buttons and says so.
async function settleClosed(parts: Parts, pressed: ButtonPress, call: Call): Promise<void> {
  const { chatId, messageId } = pressed;
  if (chatId !== undefined && messageId !== undefined) {
    await parts.bot.edit({ chatId, messageId }, wordsOf(parts)("shell.request.closedToast"), call);
  }
}

async function press(parts: Parts, pressed: ButtonPress, call: Call): Promise<boolean> {
  const callback = shellRequestCallbackSchema.safeParse(pressed.data ?? "");
  if (!callback.success) {
    return false;
  }
  const pressAsked = { ...callback.data, presserId: pressed.sender.id };
  const answered = await parts.options.answer(pressAsked, call);
  // A press the engine did not take for the owner's gets no answer at all.
  if (!answered.ok && answered.error === "auth.scope") {
    return true;
  }
  const words = wordsOf(parts);
  const isClosed = !answered.ok && answered.error === "shell.request_closed";
  if (isClosed) {
    await settleClosed(parts, pressed, call);
  }
  const notice = answered.ok
    ? undefined
    : words(isClosed ? "shell.request.closedToast" : `error.${answered.error}`);
  const { logger } = parts.options;
  await answerPress(parts.bot, { callbackId: pressed.callbackId, notice }, { ...call, logger });
  return true;
}

/**
 * Creates the agent's shell requests in the owner's chat (spec 4, section 8.6). A request is the
 * header naming the agent, its command in a code block, its folder, why it asks and until when,
 * with Allow once, Always allow (when offered) and Refuse carrying `bnf1:x:<o|a|n>:<request>`. A
 * press runs `shell/answer` for the owner alone before Telegram hears back; the first answer, from
 * any surface, edits the message into how it ended. A press on a request no longer open says so.
 */
export function createTelegramShellRequests(
  options: TelegramShellRequestsOptions,
): TelegramShellRequests {
  const formatters = createOwnerFormatters();
  const sent = new Map<string, SentRequest>();
  const formatter = () => formatters(options.display());
  const parts: Parts = { options, sent, formatter, bot: createBotCalls(options.api) };
  return {
    press: async (pressed, call) => press(parts, pressed, call),
    show: async (push, call) => show(parts, push, call),
  };
}
