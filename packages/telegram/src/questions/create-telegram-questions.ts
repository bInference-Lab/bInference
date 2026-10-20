import { type Clock, type Id, idSchema, type JsonValue, type Logger } from "@binference/core";
import { type QuestionStore, questionViewOf } from "@binference/engine/chat";
import type { OwnerStore } from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import { type QuestionView, questionViewSchema } from "@binference/protocol";
import type { Api } from "grammy";
import { z } from "zod";
import { callBotApi } from "../api/call-bot-api.js";
import { unlessGone } from "../api/unless-gone.js";
import { answerPress, sendButtonMessage, type TopicButtons } from "../chat/button-message.js";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import type { QuestionAnswers } from "../ports.js";
import type { ButtonPress } from "../updates/chat-update.schema.js";
import { questionCallbackSchema } from "./question-callback.schema.js";
import { questionButtons, questionHtml, type QuestionWords } from "./question-html.js";

/**
 * The agent's questions in the owner's chat, each with its answer buttons, and their presses:
 * `chat/question` sends a question with its buttons, `chat/questionClosed` turns every copy into
 * how it ended.
 */
export type TelegramQuestions = TopicButtons;

/** What {@link createTelegramQuestions} needs. */
export interface TelegramQuestionsOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  /** Who owns the install: the questions go to the owner's private chat. */
  readonly owners: OwnerStore;
  /** The questions as the engine keeps them, and each copy the bot sent. */
  readonly questions: Pick<QuestionStore, "get" | "keepCopy" | "copies">;
  /** The engine's side: it checks the presser and stores each answer. */
  readonly answers: QuestionAnswers;
  /** Each agent's name, by its id, for the header that says who asks. */
  readonly agentNames: (call: Call) => Promise<ReadonlyMap<string, string>>;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The owner's language and timezone as they are now, read for each message. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
}

interface Call {
  readonly signal: AbortSignal;
}

/** What the questions work with once made. */
interface Parts {
  readonly options: TelegramQuestionsOptions;
  readonly bot: BotCalls;
  readonly words: () => QuestionWords;
}

const closedSchema = z.looseObject({ question: idSchema("qst") });

async function nameOf(parts: Parts, agent: string, call: Call): Promise<string> {
  return (await parts.options.agentNames(call)).get(agent) ?? agent;
}

// Sends an open question to the owner's chat with its buttons, and keeps the copy.
async function asked(parts: Parts, question: QuestionView, call: Call): Promise<void> {
  const { options } = parts;
  const owner = await options.owners.get(call);
  const stored = await options.questions.get(question.question, call);
  if (owner === undefined || stored === undefined) {
    return;
  }
  const html = questionHtml(question, parts.words(), await nameOf(parts, question.agent, call));
  const buttons = questionButtons(question.choices, stored.ref);
  const messageId = await sendButtonMessage(
    options.api,
    { chatId: owner.userId, html, buttons },
    call.signal,
  );
  const copy = {
    questionId: stored.id,
    surface: "telegram",
    chatId: owner.userId,
    messageId,
    sentAtMs: options.clock.now(),
  } as const;
  await options.questions.keepCopy(copy, call);
}

// Every copy loses its buttons and shows how the question ended.
async function closed(parts: Parts, id: Id<"qst">, call: Call): Promise<void> {
  const { options } = parts;
  const question = await options.questions.get(id, call);
  if (question === undefined) {
    return;
  }
  const view = questionViewOf(question);
  const html = questionHtml(view, parts.words(), await nameOf(parts, view.agent, call));
  const copies = await options.questions.copies(question.id, call);
  await Promise.all(
    copies
      .filter((copy) => copy.surface === "telegram")
      .map(async (copy) =>
        unlessGone(
          callBotApi("editMessageText", call.signal, async (signal) =>
            options.api.editMessageText(
              copy.chatId,
              copy.messageId,
              html,
              { parse_mode: "HTML" },
              signal,
            ),
          ),
        ),
      ),
  );
}

async function show(
  parts: Parts,
  push: { readonly kind: string; readonly data: JsonValue },
  call: Call,
): Promise<void> {
  if (push.kind === "chat/question") {
    const question = questionViewSchema.safeParse(push.data);
    if (question.success) {
      await asked(parts, question.data, call);
    }
    return;
  }
  if (push.kind === "chat/questionClosed") {
    const ended = closedSchema.safeParse(push.data);
    if (ended.success) {
      await closed(parts, ended.data.question, call);
    }
  }
}

function noticeOf(parts: Parts, status: Awaited<ReturnType<QuestionAnswers["answer"]>>) {
  const words = parts.words();
  if (status.status === "closed") {
    return words("question.closedToast");
  }
  return status.status === "refused" ? words(`error.${status.error}`) : undefined;
}

async function press(parts: Parts, pressed: ButtonPress, call: Call): Promise<boolean> {
  const callback = questionCallbackSchema.safeParse(pressed.data ?? "");
  if (!callback.success) {
    return false;
  }
  const { ref, choice } = callback.data;
  const standing = await parts.options.answers.answer(
    { ref, choice, presserId: pressed.sender.id },
    call,
  );
  if (standing.status === "unknown") {
    return true;
  }
  const answering = { callbackId: pressed.callbackId, notice: noticeOf(parts, standing) };
  await answerPress(parts.bot, answering, { ...call, logger: parts.options.logger });
  return true;
}

/**
 * Creates the agent's questions in the owner's chat (spec 4, section 8.2). A question is the
 * agent's words, escaped, under a header naming the agent, with one button per choice carrying
 * `bnf1:q:<choice>:<ref>`. The engine checks the presser and stores the answer before Telegram
 * hears back; the first answer, from any surface, edits every copy to show how the question ended
 * and removes its buttons. A press on a question no longer open says so and changes nothing.
 */
export function createTelegramQuestions(options: TelegramQuestionsOptions): TelegramQuestions {
  const formatters = createOwnerFormatters();
  const parts: Parts = {
    options,
    bot: createBotCalls(options.api),
    words: () => {
      const formatter = formatters(options.display());
      // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
      return (key, values) => formatter.message(key, values);
    },
  };
  return {
    show: async (push, call) => show(parts, push, call),
    press: async (pressed, call) => press(parts, pressed, call),
  };
}
