import type { ChainRegistry } from "@binference/chain";
import type { Clock, Logger, Random, Secret } from "@binference/core";
import type { AnswerCard, EngineStores, VenueHost } from "@binference/engine";
import { issueLaunchTicket } from "@binference/engine/access";
import type { OwnerImageSource } from "@binference/engine/chat";
import {
  type CardCopyStore,
  createCardPresses,
  createCardShowings,
  createOwnerCalls,
  createQuestionPresses,
  type EngineHandlerTable,
  type OwnerStore,
} from "@binference/engine/surfaces";
import type { OwnerInfo } from "@binference/protocol";
import {
  type CardAnswers,
  type ChatIntake,
  createChatIntake,
  createChatReplies,
  createFastCommands,
  createNoticeOutbox,
  createTelegramCards,
  createTelegramIngress,
  createTelegramQuestions,
  type FastCommands,
  type NoticeTopics,
  type OwnerCalls,
  type OwnerUpdateSink,
  type QuestionAnswers,
  type TelegramCards,
  type TelegramIngress,
  type TelegramQuestions,
} from "@binference/telegram";
import type { Api } from "grammy";
import {
  createTelegramRelay,
  type TelegramRelay,
  type TelegramRelayContext,
} from "./telegram-relay.js";

/** The owner's bot as the engine serves it. */
export interface TelegramParts {
  /** The bot's grammY `Api`, with its token's throttler installed (`createBotThrottlers`). */
  readonly api: Api;
  /** Who owns the install: only the owner's numeric Telegram id counts. */
  readonly owners: OwnerStore;
  /** Where each card version was posted, so every copy can become its receipt. */
  readonly copies: CardCopyStore;
  /**
   * The agents' topics in the owner's chat (decision 0186): whether `telegram.topicsPerAgent` is
   * on now, and where each agent's topic is kept. Left out, every notice goes to the chat itself.
   */
  readonly topics?: NoticeTopics;
  /** The bot's token, which also checks the signature of each Mini App launch. */
  readonly botToken: Secret;
  /** The Mini App's HTTPS address, which `/console` opens; none without `remote.publicUrl`. */
  readonly miniAppUrl?: string;
  /** The photos the owner sends the bot, which the runtime reads with `inbox/readImage`. */
  readonly images?: OwnerImageSource;
}

/**
 * What the bot is joined to: the engine's stores, its answer step, the handlers its fast commands
 * run and the owner's display.
 */
export interface TelegramWiring {
  readonly stores: EngineStores;
  readonly answer: AnswerCard;
  /** The engine's handlers and the composition root's, such as `engine/status`. */
  readonly handlers: EngineHandlerTable;
  readonly chains: ChainRegistry;
  /** Which venues declare that their trade calls carry no deadline, for the card's warning. */
  readonly venues: Pick<VenueHost, "hasNoDeadline">;
  /** The owner's language and timezone now, read for each message the bot sends. */
  readonly owner: () => OwnerInfo;
  /** Resolves once every notice published so far is stored, so the outbox holds it. */
  readonly stored: () => Promise<void>;
  /** Hears the numeric Telegram id of an owner a new pairing replaced. */
  readonly ownerReplaced: (userId: number) => void;
  readonly clock: Clock;
  /** Makes the Mini App's launch tickets. */
  readonly random: Random;
  readonly logger: Logger;
  /** Whether the engine is locked now, which a card's `locked` auto mode line reads. */
  readonly isLocked?: () => boolean;
}

/** The owner's bot joined to the engine: its cards, where its updates come in, and the relay. */
export interface ComposedTelegram extends TelegramRelay {
  readonly cards: TelegramCards;
  /** The engine's side of each press: the owner's only, stored before Telegram hears back. */
  readonly answers: CardAnswers;
  /** The agent's questions with their buttons, whose presses the engine answers. */
  readonly questions: TelegramQuestions;
  /** The engine's side of each press of a question's button: the owner's only, stored first. */
  readonly questionAnswers: QuestionAnswers;
  /** The engine's side of the fast commands: each operation runs for the owner alone. */
  readonly calls: OwnerCalls;
  /** The owner's fast commands; whoever starts the bot registers their menu. */
  readonly commands: FastCommands;
  /** Where the bot's updates come in: long polling and a webhook relay both feed it. */
  readonly ingress: TelegramIngress;
  /** The owner's messages to the agent, batched and posted with `chat/post`. */
  readonly chat: ChatIntake;
}

interface Call {
  readonly signal: AbortSignal;
}

/** The owner's language and timezone now. */
type OwnerDisplay = () => { readonly locale: OwnerInfo["locale"]; readonly timeZone: string };

// The owner's numeric Telegram id, read for each press and command.
function answersOwner(parts: TelegramParts) {
  return async (call: Call): Promise<number | undefined> => (await parts.owners.get(call))?.userId;
}

// `/console`'s launch tickets, kept as hashes in the engine's access store.
function launchTicketsOf(wiring: TelegramWiring) {
  const { stores, clock, random } = wiring;
  return async (request: { readonly userId: number; readonly signal: AbortSignal }) =>
    issueLaunchTicket({ access: stores.access, clock, random }, request);
}

// The line to the owner's chat: the cards, the notices from the outbox, the agent's replies and
// its questions.
function relayOf(
  parts: TelegramParts,
  wiring: TelegramWiring,
  chat: Pick<TelegramRelayContext, "showings" | "cards"> & {
    readonly display: OwnerDisplay;
    readonly questions: TelegramQuestions;
  },
): TelegramRelay {
  const { clock, logger, chains } = wiring;
  const { showings, cards, display, questions } = chat;
  const { notices, agents } = wiring.stores;
  const outbox = createNoticeOutbox({ ...parts, notices, agents, chains, display, clock, logger });
  const agentNames = agentNamesOf(wiring, { active: true });
  const replies = createChatReplies({ ...parts, clock, logger, display, agentNames });
  const shown = {
    ...replies,
    show: async (...args: Parameters<typeof replies.show>) => {
      await replies.show(...args);
      await questions.show(...args);
    },
  };
  const { stored } = wiring;
  return createTelegramRelay({ showings, cards, outbox, chat: shown, stored, clock, logger });
}

// Each agent's name, by its id, as the owner named it: every agent's, or those not archived.
function agentNamesOf(wiring: TelegramWiring, which: { readonly active: boolean }) {
  return async (call: Call): Promise<ReadonlyMap<string, string>> => {
    const agents = await wiring.stores.agents.list(call);
    const kept = which.active ? agents.filter((agent) => agent.archivedAtMs === undefined) : agents;
    return new Map(kept.map((agent) => [agent.id, agent.name]));
  };
}

// The owner's language and timezone as config.json5 holds them now.
function displayOf(wiring: TelegramWiring): OwnerDisplay {
  return () => {
    const { locale, timezone } = wiring.owner();
    return { locale, timeZone: timezone };
  };
}

// A fast command and its buttons are answered here, a card's press goes to the cards, and any other
// message goes to the agent.
function ownerUpdateSink(to: {
  readonly commands: FastCommands;
  readonly questions: TelegramQuestions;
  readonly cards: TelegramCards;
  readonly chat: ChatIntake;
}): OwnerUpdateSink {
  return async (update, call) => {
    if (update.kind !== "callback") {
      if (!(await to.commands.answer(update, call))) {
        await to.chat.take(update, call);
      }
      return;
    }
    const taken =
      (await to.commands.press(update, call)) || (await to.questions.press(update, call));
    if (!taken) {
      await to.cards.press(update, call);
    }
  };
}

// The owner's fast commands, which run their operations through `calls`.
function commandsOf(
  parts: TelegramParts,
  wiring: TelegramWiring,
  given: {
    readonly calls: OwnerCalls;
    readonly cards: TelegramCards;
    readonly showings: Pick<ReturnType<typeof createCardShowings>, "waiting">;
    readonly display: OwnerDisplay;
  },
): FastCommands {
  const { calls, cards, showings, display } = given;
  return createFastCommands({
    api: parts.api,
    calls,
    owners: parts.owners,
    cards,
    waiting: async (call) => showings.waiting(call),
    chains: wiring.chains,
    display,
    ...(parts.miniAppUrl === undefined ? {} : { miniAppUrl: parts.miniAppUrl }),
    issueLaunchTicket: launchTicketsOf(wiring),
    clock: wiring.clock,
    logger: wiring.logger,
  });
}

// The agent's questions in the owner's chat, whose presses the engine answers through `calls`.
function questionsOf(
  parts: TelegramParts,
  wiring: TelegramWiring,
  given: { readonly calls: OwnerCalls; readonly display: OwnerDisplay },
) {
  const { stores, logger } = wiring;
  const { calls, display } = given;
  const questionAnswers = createQuestionPresses({
    questions: stores.questions,
    calls,
    ownerId: answersOwner(parts),
  });
  const questions = createTelegramQuestions({
    ...parts,
    questions: stores.questions,
    answers: questionAnswers,
    agentNames: agentNamesOf(wiring, { active: false }),
    clock: wiring.clock,
    logger,
    display,
  });
  return { questions, questionAnswers };
}

/**
 * Joins the owner's bot to the engine: cards whose presses the engine answers (the owner's
 * numeric Telegram id only, stored before Telegram hears back), the ingress that hands the
 * owner's presses to them, and the relay that shows each new card version in the owner's chat,
 * sends the notices from the outbox once started (decision 0133) and shows the agent's replies.
 * The owner's messages that are not fast commands go to the agent with `chat/post`.
 */
export function composeTelegram(parts: TelegramParts, wiring: TelegramWiring): ComposedTelegram {
  const { stores, chains, logger } = wiring;
  const display = displayOf(wiring);
  const answers = createCardPresses({
    intents: stores.intents,
    answer: wiring.answer,
    ownerId: answersOwner(parts),
    chains,
  });
  const cards = createTelegramCards({ ...parts, answers, clock: wiring.clock, logger, display });
  const locked = wiring.isLocked === undefined ? {} : { isLocked: wiring.isLocked };
  const showings = createCardShowings({ ...stores, chains, venues: wiring.venues, ...locked });
  const calls = createOwnerCalls({ handlers: wiring.handlers, ownerId: answersOwner(parts) });
  const commands = commandsOf(parts, wiring, { calls, cards, showings, display });
  const { questions, questionAnswers } = questionsOf(parts, wiring, { calls, display });
  const relay = relayOf(parts, wiring, { showings, cards, display, questions });
  const chat = createChatIntake({ ...parts, calls, clock: wiring.clock, logger, display });
  const ingress = createTelegramIngress({
    api: parts.api,
    stores: { inbox: stores.inbox, access: stores.access, owners: parts.owners },
    clock: wiring.clock,
    logger,
    display,
    onOwnerUpdate: ownerUpdateSink({ commands, questions, cards, chat }),
    onOwnerPaired: () => relay.paired(),
    // The replaced owner's sessions end before the bot says a word to anyone.
    onOwnerReplaced: (replaced) => wiring.ownerReplaced(replaced.userId),
  });
  return {
    cards,
    answers,
    questions,
    questionAnswers,
    calls,
    commands,
    ingress,
    chat,
    ...relay,
    async close() {
      await chat.close();
      await relay.close();
    },
  };
}
