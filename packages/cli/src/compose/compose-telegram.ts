import type { ChainRegistry } from "@binference/chain";
import type { Clock, Logger } from "@binference/core";
import type { AnswerCard, EngineStores } from "@binference/engine";
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
  createFastCommands,
  createNoticeOutbox,
  createTelegramCards,
  createTelegramIngress,
  type FastCommands,
  type OwnerCalls,
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
  /** The owner's language and timezone now, read for each message the bot sends. */
  readonly owner: () => OwnerInfo;
  /** Resolves once every notice published so far is stored, so the outbox holds it. */
  readonly stored: () => Promise<void>;
  readonly clock: Clock;
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

// The line to the owner's chat: the cards, and the notices from the outbox.
function relayOf(
  parts: TelegramParts,
  wiring: TelegramWiring,
  chat: Pick<TelegramRelayContext, "showings" | "cards"> & { readonly display: OwnerDisplay },
): TelegramRelay {
  const { clock, logger, chains } = wiring;
  const { showings, cards, display } = chat;
  const notices = wiring.stores.notices;
  const outbox = createNoticeOutbox({ ...parts, notices, chains, display, clock, logger });
  return createTelegramRelay({ showings, cards, outbox, stored: wiring.stored, clock, logger });
}

/**
 * Joins the owner's bot to the engine: cards whose presses the engine answers (the owner's
 * numeric Telegram id only, stored before Telegram hears back), the ingress that hands the
 * owner's presses to them, and the relay that shows each new card version in the owner's chat and
 * sends the notices from the outbox once started (decision 0133). The owner's chat messages are
 * stored in the inbox and go no further until the agent runtime joins.
 */
export function composeTelegram(parts: TelegramParts, wiring: TelegramWiring): ComposedTelegram {
  const { stores, chains, logger } = wiring;
  const display = () => {
    const { locale, timezone } = wiring.owner();
    return { locale, timeZone: timezone };
  };
  const answers = createCardPresses({
    intents: stores.intents,
    answer: wiring.answer,
    ownerId: answersOwner(parts),
    chains,
  });
  const cards = createTelegramCards({ ...parts, answers, logger, display });
  const showings = createCardShowings({ intents: stores.intents, agents: stores.agents, chains });
  const calls = createOwnerCalls({ handlers: wiring.handlers, ownerId: answersOwner(parts) });
  const commands = createFastCommands({
    api: parts.api,
    calls,
    cards,
    waiting: async (call) => showings.waiting(call),
    chains,
    display,
    logger,
  });
  const relay = relayOf(parts, wiring, { showings, cards, display });
  const ingress = createTelegramIngress({
    api: parts.api,
    stores: { inbox: stores.inbox, access: stores.access, owners: parts.owners },
    clock: wiring.clock,
    logger,
    display,
    // A fast command and its buttons are answered here; any other message waits for the agent
    // runtime.
    onOwnerUpdate: async (update, call) => {
      if (update.kind !== "callback") {
        await commands.answer(update, call);
        return;
      }
      if (!(await commands.press(update, call))) {
        await cards.press(update, call);
      }
    },
    onOwnerPaired: () => relay.paired(),
  });
  return { cards, answers, calls, commands, ingress, ...relay };
}
