import type { ChainRegistry } from "@binference/chain";
import type { Clock, Logger, Random, Secret } from "@binference/core";
import type { AnswerCard, EngineStores, VenueHost } from "@binference/engine";
import { issueLaunchTicket } from "@binference/engine/access";
import {
  type CardCopyStore,
  createCardPresses,
  createCardShowings,
  createOwnerCalls,
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
  type FastCommands,
  type OwnerCalls,
  type OwnerUpdateSink,
  type TelegramCards,
  type TelegramIngress,
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
  /** The bot's token, which also checks the signature of each Mini App launch. */
  readonly botToken: Secret;
  /** The Mini App's HTTPS address, which `/console` opens; none without `remote.publicUrl`. */
  readonly miniAppUrl?: string;
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
}

/** The owner's bot joined to the engine: its cards, where its updates come in, and the relay. */
export interface ComposedTelegram extends TelegramRelay {
  readonly cards: TelegramCards;
  /** The engine's side of each press: the owner's only, stored before Telegram hears back. */
  readonly answers: CardAnswers;
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

// The line to the owner's chat: the cards, the notices from the outbox and the agent's replies.
function relayOf(
  parts: TelegramParts,
  wiring: TelegramWiring,
  chat: Pick<TelegramRelayContext, "showings" | "cards"> & { readonly display: OwnerDisplay },
): TelegramRelay {
  const { clock, logger, chains } = wiring;
  const { showings, cards, display } = chat;
  const notices = wiring.stores.notices;
  const outbox = createNoticeOutbox({ ...parts, notices, chains, display, clock, logger });
  const replies = createChatReplies({ ...parts, clock, logger, display });
  const { stored } = wiring;
  return createTelegramRelay({ showings, cards, outbox, chat: replies, stored, clock, logger });
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
    if (!(await to.commands.press(update, call))) {
      await to.cards.press(update, call);
    }
  };
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
  const showings = createCardShowings({ ...stores, chains, venues: wiring.venues });
  const calls = createOwnerCalls({ handlers: wiring.handlers, ownerId: answersOwner(parts) });
  const commands = createFastCommands({
    api: parts.api,
    calls,
    cards,
    waiting: async (call) => showings.waiting(call),
    chains,
    display,
    ...(parts.miniAppUrl === undefined ? {} : { miniAppUrl: parts.miniAppUrl }),
    issueLaunchTicket: launchTicketsOf(wiring),
    logger,
  });
  const relay = relayOf(parts, wiring, { showings, cards, display });
  const chat = createChatIntake({ api: parts.api, calls, clock: wiring.clock, logger, display });
  const ingress = createTelegramIngress({
    api: parts.api,
    stores: { inbox: stores.inbox, access: stores.access, owners: parts.owners },
    clock: wiring.clock,
    logger,
    display,
    onOwnerUpdate: ownerUpdateSink({ commands, cards, chat }),
    onOwnerPaired: () => relay.paired(),
    // The replaced owner's sessions end before the bot says a word to anyone.
    onOwnerReplaced: (replaced) => wiring.ownerReplaced(replaced.userId),
  });
  return {
    cards,
    answers,
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
